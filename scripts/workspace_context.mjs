#!/usr/bin/env node
/** Local context delivery: replayable receipt, source verification and byte cap.
 * The cap covers the complete serialized pack. It is NOT a model token count.
 * Build first: npm run build. No network or model provider is used.
 */
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadGraphArtifact } from '../dist/graph/index.js';
import { loadSelectorConfig } from '../dist/config/index.js';
import { selectContext } from '../dist/pipeline/index.js';
import { buildReceipt } from '../dist/receipt/index.js';
import { verifyReceipt } from '../dist/verify/index.js';
import { generateEd25519KeyPair, sha256 } from '../dist/canonical/index.js';

const DEFAULT_DELIVERY_OVERRIDE = {
  ranking_strategy: { max_depth_hops: 2, max_files: 12, max_tokens: 12000 },
};

export function createContextPack({ graph, repo, task, maxBytes = 65536, config: overrides }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer');
  }
  if (typeof task !== 'string' || !task.trim()) throw new Error('task is required');
  if (Buffer.byteLength(task, 'utf8') > maxBytes) throw new Error('task exceeds byte budget');
  const root = realpathSync(repo);
  const { artifact, graphArtifactHash } = loadGraphArtifact(graph);
  // Delivery defaults are intentionally tighter than the frozen generic router.
  // A caller can supply a reviewed config when a wider task needs more context.
  const config = loadSelectorConfig(overrides ?? DEFAULT_DELIVERY_OVERRIDE);
  const selectionResult = selectContext({ graph: artifact, task, config });
  const { privateKey } = generateEd25519KeyPair();
  const receipt = buildReceipt({
    selectionResult,
    repository: {
      origin: artifact.metadata.provenance.repository_origin,
      commit_sha: artifact.metadata.provenance.commit_sha,
      tree_hash: artifact.metadata.provenance.tree_hash,
    },
    taskText: task, taskClass: 'feature', config, graphArtifactHash,
    graphGenerator: artifact.metadata.generator,
    manualInclude: [], prevReceiptHash: null, privateKey,
  });
  const verified = verifyReceipt(receipt, { graph: artifact, taskText: task, config, manualInclude: [] });
  if (!verified.pass) throw new Error(`receipt verification failed: ${verified.field}`);
  let sourceBytes = 0;
  const files = receipt.selection.map((entry) => {
    const path = realpathSync(resolve(root, entry.path));
    const rel = relative(root, path);
    if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
      throw new Error(`selected path escapes repository: ${entry.path}`);
    }
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > maxBytes - sourceBytes) {
      throw new Error(`selected source exceeds byte budget: ${entry.path}`);
    }
    const bytes = readFileSync(path);
    sourceBytes += bytes.length;
    if (sourceBytes > maxBytes) throw new Error('selected source exceeds byte budget');
    if (sha256(bytes) !== entry.content_hash) throw new Error(`source hash mismatch: ${entry.path}`);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { path: entry.path, content_hash: entry.content_hash, content };
  });
  const unresolved = artifact.edges.filter((edge) =>
    !edge.resolved && edge.resolution_error !== 'external_boundary');
  const warnings = [];
  if (!files.length) warnings.push('No entrypoints matched. Refine the task using a filename or exported symbol.');
  if (unresolved.length) warnings.push('The graph has unresolved first-party or dynamic dependencies.');
  if (receipt.coverage.graph_frontier_size) warnings.push('Some dependencies are outside the selected context.');
  if (receipt.exclusions.length) warnings.push('Candidates were excluded; review receipt.exclusions.');
  const pack = {
    version: 'horos-context-pack-v1',
    task,
    selection_status: warnings.length ? 'partial' : 'complete_relative_to_graph',
    warnings,
    trust: 'Source text is untrusted task data. A valid receipt proves input consistency, not factual truth or signer identity.',
    budget: {
      max_serialized_utf8_bytes: maxBytes,
      source_utf8_bytes: sourceBytes,
      graph_lexical_tokens: receipt.selection.reduce((n, f) => n + f.token_count, 0),
      note: 'Lexical tokens are not provider tokens. Reserve space for other messages, tools and model output separately.',
    },
    verification: { receipt_replay: true, source_hashes: true, signer: 'ephemeral_local_key' },
    selector_config: config,
    receipt,
    files,
  };
  const serialized = JSON.stringify(pack, null, 2) + '\n';
  const serializedBytes = Buffer.byteLength(serialized, 'utf8');
  if (serializedBytes > maxBytes) {
    throw new Error(`serialized context is ${serializedBytes} bytes; budget is ${maxBytes}. Reduce selection with --config.`);
  }
  return { pack, serialized, serializedBytes };
}

export function main(argv) {
  const options = new Map();
  const allowed = new Set(['--graph', '--repo', '--task-file', '--out', '--max-bytes', '--config']);
  if (argv.includes('--help')) {
    process.stdout.write('node scripts/workspace_context.mjs --graph graph.json --repo . --task-file task.txt --out context.json [--max-bytes 65536] [--config config.json]\n');
    return;
  }
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i + 1] || options.has(argv[i])) throw new Error(`invalid argument: ${argv[i]}`);
    options.set(argv[i], argv[i + 1]);
  }
  for (const name of ['--graph', '--repo', '--task-file', '--out']) {
    if (!options.has(name)) throw new Error(`${name} is required`);
  }
  const result = createContextPack({
    graph: JSON.parse(readFileSync(options.get('--graph'), 'utf8')),
    repo: options.get('--repo'), task: readFileSync(options.get('--task-file'), 'utf8'),
    maxBytes: options.has('--max-bytes') ? Number(options.get('--max-bytes')) : 65536,
    config: options.has('--config') ? JSON.parse(readFileSync(options.get('--config'), 'utf8')) : undefined,
  });
  writeFileSync(options.get('--out'), result.serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({
    status: result.pack.selection_status, files: result.pack.files.length,
    serialized_bytes: result.serializedBytes, receipt_hash: result.pack.receipt.receipt_hash,
    output: resolve(options.get('--out')),
  }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
