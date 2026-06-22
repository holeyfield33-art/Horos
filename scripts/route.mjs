/**
 * Route a task against a context-graph-v0 artifact and emit a signed receipt.
 *
 * Usage:
 *   node scripts/route.mjs <graph.json> <task text> [--key <hex-seed>] [--out <file>]
 *
 * <graph.json>  path to the generated graph artifact (required)
 * <task text>   natural-language description of the task (required)
 * --key         32-byte hex seed for the Ed25519 signing key;
 *               if omitted, a random key is generated and the public key is
 *               printed to stderr so you can verify the receipt later
 * --out         output file; default stdout
 *
 * The receipt is JSON. Verify it with:
 *   node dist/cli/horos.js verify receipt.json --graph graph.json --task "<task>"
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { loadGraphArtifact } = await import(`${here}/../dist/graph/index.js`);
const { DEFAULT_SELECTOR_CONFIG } = await import(`${here}/../dist/config/index.js`);
const { selectContext } = await import(`${here}/../dist/pipeline/index.js`);
const { buildReceipt } = await import(`${here}/../dist/receipt/index.js`);
const {
  generateEd25519KeyPair,
  ed25519PrivateKeyFromSeed,
  ed25519PublicKeyToHex,
  ed25519PublicKeyFromPrivate,
} = await import(`${here}/../dist/canonical/index.js`);

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--key") opts.key = argv[++i];
    else if (argv[i] === "--out") opts.out = argv[++i];
    else positional.push(argv[i]);
  }
  return { positional, opts };
}

const { positional, opts } = parseArgs(process.argv.slice(2));
const [graphPath, ...taskParts] = positional;
const taskText = taskParts.join(" ");

if (!graphPath || !taskText) {
  process.stderr.write("usage: node scripts/route.mjs <graph.json> <task text> [--key <hex-seed>] [--out <file>]\n");
  process.exit(2);
}

const rawGraph = JSON.parse(readFileSync(graphPath, "utf8"));
const { artifact, graphArtifactHash } = loadGraphArtifact(rawGraph);

const config = DEFAULT_SELECTOR_CONFIG;
const selectionResult = selectContext({ graph: artifact, task: taskText, config });

let privateKey;
if (opts.key) {
  privateKey = ed25519PrivateKeyFromSeed(opts.key);
} else {
  const pair = generateEd25519KeyPair();
  privateKey = pair.privateKey;
}
const publicKey = ed25519PublicKeyFromPrivate(privateKey);
const publicKeyHex = ed25519PublicKeyToHex(publicKey);

const receipt = buildReceipt({
  selectionResult,
  repository: {
    origin: artifact.metadata.provenance.repository_origin,
    commit_sha: artifact.metadata.provenance.commit_sha,
    tree_hash: artifact.metadata.provenance.tree_hash,
  },
  taskText,
  taskClass: "feature",
  config,
  graphArtifactHash,
  graphGenerator: {
    name: artifact.metadata.generator.name,
    version: artifact.metadata.generator.version,
  },
  manualInclude: [],
  prevReceiptHash: null,
  privateKey,
});

const json = JSON.stringify(receipt, null, 2);

process.stderr.write(`public_key: ${publicKeyHex}\n`);
process.stderr.write(`receipt_hash: ${receipt.receipt_hash}\n`);
process.stderr.write(`selected: ${receipt.coverage.files_selected} files\n`);

if (opts.out) {
  writeFileSync(opts.out, json, "utf8");
  process.stderr.write(`receipt written to ${opts.out}\n`);
} else {
  process.stdout.write(json + "\n");
}
