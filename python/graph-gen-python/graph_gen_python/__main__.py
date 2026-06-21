"""CLI entry point — SPEC §8/§10, build PR P4.

    python -m graph_gen_python --repo <dir> --config horos.json [--out graph.json]
        [--repository-origin <url>] [--commit-sha <sha>] [--generated-at <iso8601>]

Emits the context-graph-v0 artifact (stdout or --out) and prints the completion
report (SPEC §8) to stderr. Determinism (SPEC §10): the same commit + same
horos.json yields a byte-identical artifact. `generated_at` defaults to the
commit's committer date (deterministic), NOT the wall clock; override with
--generated-at.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from .artifact import generate
from .config import ConfigError, load_config
from .report import format_report

_FALLBACK_TIMESTAMP = "1970-01-01T00:00:00+00:00"


def _default_generated_at(repo_root: Path) -> str:
    """Deterministic timestamp: the HEAD committer date, or a fixed fallback."""
    try:
        out = subprocess.run(
            ["git", "show", "-s", "--format=%cI", "HEAD"],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
        value = out.stdout.decode("utf-8").strip()
        return value or _FALLBACK_TIMESTAMP
    except (OSError, subprocess.CalledProcessError):
        return _FALLBACK_TIMESTAMP


def _default_repository_origin(repo_root: Path) -> str:
    try:
        out = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
        return out.stdout.decode("utf-8").strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="graph_gen_python")
    p.add_argument("--repo", required=True, help="repository root to analyze")
    p.add_argument("--config", required=True, help="path to horos.json")
    p.add_argument("--out", help="write artifact here (default: stdout)")
    p.add_argument("--repository-origin", dest="repository_origin")
    p.add_argument("--commit-sha", dest="commit_sha")
    p.add_argument("--generated-at", dest="generated_at")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = Path(args.repo).resolve()

    try:
        config = load_config(args.config)
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    generated_at = args.generated_at or _default_generated_at(repo_root)
    repository_origin = (
        args.repository_origin
        if args.repository_origin is not None
        else _default_repository_origin(repo_root)
    )

    result = generate(
        repo_root,
        config,
        repository_origin=repository_origin,
        commit_sha=args.commit_sha,
        generated_at=generated_at,
    )

    text = json.dumps(result.artifact, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)

    print(format_report(result.unresolved_module_not_found), file=sys.stderr)
    print(f"graph_artifact_hash: {result.artifact_hash}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
