"""Reproducible, offline cross-repository smoke evaluation.

Run after building Horos: python scripts/workspace_eval.py [--with-mneme]
This measures deterministic selection on curated code tasks, not model accuracy,
provider token savings, or production latency. Artifacts stay in .local/audit/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HOROS = Path(__file__).resolve().parents[1]
WORKSPACE = HOROS.parent
sys.path.insert(0, str(HOROS / 'python' / 'graph-gen-python'))
sys.path.insert(0, str(WORKSPACE / 'ATG'))

from graph_gen_python.artifact import generate
from graph_gen_python.config import load_config
from atg.checkpoint import CheckpointStore
from atg.usage import check_context_budget, decide_action

CASES = [
    ('horos', 'verify receipt signature', ['src/verify/verify.ts', 'src/receipt/receipt.ts']),
    ('horos', 'selectContext budget enforcement', ['src/pipeline/select.ts']),
    ('horos', 'loadGraphArtifact validation', ['src/graph/loader.ts']),
    ('ATG', 'checkpoint integrity', ['atg/checkpoint.py']),
    ('ATG', 'usage rate limit', ['atg/usage.py']),
    ('Mneme-', 'storage memory', ['aletheia-mneme/storage.py']),
    ('Mneme-', 'embeddings offline', ['aletheia-mneme/embeddings.py']),
]


def run(args: list[str], cwd: Path = HOROS) -> str:
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                            encoding='utf-8', timeout=180)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed: {result.stderr[-2000:]}')
    return result.stdout


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--with-mneme', action='store_true', help='also verify local memory and linked ATG resume')
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = HOROS / '.local' / 'audit' / f'eval-{stamp}-{secrets.token_hex(3)}'
    output.mkdir(parents=True)
    graphs = {}
    generation = {}
    for name in ['horos', 'ATG', 'Mneme-']:
        repo = WORKSPACE / name
        graph_path = output / f'{name}-graph.json'
        start = time.perf_counter()
        if name == 'horos':
            run(['node', str(HOROS / 'dist/cli/horos.js'), 'generate', '--tsconfig',
                 str(HOROS / 'tsconfig.build.json'), '--repo', str(repo), '--out', str(graph_path)])
        else:
            roots = ['atg'] if name == 'ATG' else ['aletheia-mneme']
            cfg = output / f'{name}-config.json'
            write_json(cfg, {'python_source_roots': roots, 'external_modules': [
                'mcp', 'pytest', 'pytest_asyncio', 'fastapi', 'starlette', 'dotenv',
                'openai', 'argon2', 'slowapi', 'structlog', 'asyncpg', 'pgvector',
                'resend', 'httpx', 'pydantic', 'anyio', 'sentence_transformers', 'uvicorn',
            ]})
            result = generate(repo, load_config(cfg), repository_origin=f'local:{name}',
                              generated_at='2026-09-09T00:00:00Z')
            write_json(graph_path, result.artifact)
        graph = json.loads(graph_path.read_text(encoding='utf-8'))
        graphs[name] = (graph_path, graph)
        generation[name] = {'milliseconds': round((time.perf_counter() - start) * 1000, 2),
                            'indexed_files': len(graph['nodes'])}

    results = []
    for i, (name, task, expected) in enumerate(CASES):
        graph_path, graph = graphs[name]
        task_path = output / f'task-{i}.txt'
        task_path.write_text(task, encoding='utf-8')
        pack_path = output / f'context-{i}.json'
        start = time.perf_counter()
        summary = json.loads(run(['node', str(HOROS / 'scripts/workspace_context.mjs'),
            '--graph', str(graph_path), '--repo', str(WORKSPACE / name),
            '--task-file', str(task_path), '--out', str(pack_path), '--max-bytes', '65536']))
        elapsed = round((time.perf_counter() - start) * 1000, 2)
        pack = json.loads(pack_path.read_text(encoding='utf-8'))
        selected = {f['path'] for f in pack['files']}
        indexed_bytes = sum((WORKSPACE / name / p).stat().st_size for p in graph['nodes'])
        results.append({
            'repository': name, 'task': task, 'expected_anchor_files': expected,
            'anchor_files_found': sorted(selected.intersection(expected)),
            'anchors_pass': set(expected) <= selected,
            'selected_files': len(selected), 'indexed_files': len(graph['nodes']),
            'indexed_source_bytes': indexed_bytes,
            'selected_source_bytes': pack['budget']['source_utf8_bytes'],
            'serialized_pack_bytes': summary['serialized_bytes'],
            'selection_status': pack['selection_status'], 'pack_milliseconds': elapsed,
            'receipt_hash': pack['receipt']['receipt_hash'], 'pack_path': str(pack_path),
        })

    # Synthetic telemetry exercises policy; it is not measured provider usage.
    policy = {
        'unknown_usage': decide_action()['action'],
        'exhausted_usage': decide_action(remaining_tokens=0)['action'],
        'context_overflow': check_context_budget(8192, 7000, 2000, 1024, 512)['action'],
        'context_fits': check_context_budget(32768, 4096, 1024, 2048, 1024)['action'],
    }
    policy_pass = (policy['unknown_usage'] == policy['exhausted_usage'] == policy['context_overflow'] == 'pause'
                   and policy['context_fits'] == 'proceed')
    key = secrets.token_hex(32)
    key_path = output / 'checkpoint-integrity-key.txt'
    key_path.write_text(key, encoding='utf-8')
    db_path = output / 'checkpoints.db'
    store = CheckpointStore(db_path, integrity_key=key)
    memory_key = f'workspace/horos-atg-mneme/eval/{stamp}-{output.name[-6:]}'
    metadata = {'horos_receipt_hash': results[0]['receipt_hash'], 'mneme_memory_key': memory_key}
    store.save('workspace-audit', {'completed': 'route-and-verify', 'next': 'review-audit-gaps'}, meta=metadata)
    # A fresh store opens an existing durable database, as a resumed agent does.
    restored = CheckpointStore(db_path, integrity_key=key).load('workspace-audit')
    checkpoint_pass = bool(restored and restored['integrity_ok'] and restored['meta'] == metadata)
    memory = {'requested': args.with_mneme, 'verified': False}
    if args.with_mneme:
        client = WORKSPACE / 'Mneme-' / 'scripts/local_client.py'
        python = WORKSPACE / 'Mneme-' / '.venv-local/Scripts/python.exe'
        if not python.exists():
            python = WORKSPACE / 'Mneme-' / '.venv-local/bin/python'
        content = json.dumps({'source': 'workspace_eval', 'task': 'cross-project audit',
                              'receipt_hash': results[0]['receipt_hash'], 'checkpoint_work_id': 'workspace-audit'}, sort_keys=True)
        replies = {}
        for tool, arguments in [
            ('store_memory', {'key': memory_key, 'value': content, 'category': 'handoff'}),
            ('get_memory', {'key': memory_key}), ('verify_memory', {'key': memory_key}),
        ]:
            request_path = output / f'{tool}.json'
            write_json(request_path, {'tool': tool, 'arguments': arguments})
            response = json.loads(run([str(python), str(client), '--request-file', str(request_path)]))
            replies[tool] = response
        write_json(output / 'mneme-roundtrip.json', replies)
        # Keep protocol-independent evidence; inspect structured response flags.
        fetched = json.dumps(replies['get_memory'], ensure_ascii=False)
        verified_text = json.dumps(replies['verify_memory']).lower()
        memory['verified'] = content in fetched or content.replace('"', '\\"') in fetched
        memory['integrity_response'] = replies['verify_memory']
        memory['memory_key'] = memory_key
        if '"iserror": true' in verified_text or '"verified": false' in verified_text:
            memory['verified'] = False

    report = {'generated_at': stamp, 'scope': 'offline curated selection and durable state smoke test; not model accuracy or load testing',
              'generation': generation, 'cases': results, 'policy_synthetic_inputs': policy,
              'policy_pass': policy_pass, 'checkpoint_restart_pass': checkpoint_pass, 'memory': memory}
    report['pass'] = (all(r['anchors_pass'] for r in results) and policy_pass and checkpoint_pass
                      and (not args.with_mneme or memory['verified']))
    write_json(output / 'report.json', report)
    print(json.dumps({'pass': report['pass'], 'anchor_cases': sum(r['anchors_pass'] for r in results),
                      'total_cases': len(results), 'policy_pass': policy_pass,
                      'checkpoint_restart_pass': checkpoint_pass, 'memory_verified': memory['verified'],
                      'report': str(output / 'report.json')}))
    return 0 if report['pass'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
