/**
 * P5 router-parity harness — drives the UNCHANGED TS router against a
 * Python-generated graph artifact (correction C5). This is the authoritative
 * acceptance proof: the Python output must load, select, sign, and verify
 * end-to-end through the real router exactly as a TS-generated graph would.
 *
 * Usage: node verify_parity.mjs <graph.json> "<task text>"
 * Exit 0 + "PASS ..." on success; exit 1 + "FAIL ..." otherwise.
 *
 * Imports resolve from the repo's built dist/ (three levels up from this file).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, "../../../../dist");

const { loadGraphArtifact } = await import(`${distRoot}/graph/index.js`);
const { selectContext } = await import(`${distRoot}/pipeline/index.js`);
const { buildReceipt } = await import(`${distRoot}/receipt/index.js`);
const { verifyReceipt } = await import(`${distRoot}/verify/index.js`);
const { DEFAULT_SELECTOR_CONFIG } = await import(`${distRoot}/config/index.js`);
const { ed25519PrivateKeyFromSeed } = await import(`${distRoot}/canonical/index.js`);

function main() {
  const graphPath = process.argv[2];
  const task = process.argv[3] ?? "helper relutil leaf";
  if (graphPath === undefined) {
    console.error("FAIL usage: node verify_parity.mjs <graph.json> <task>");
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(graphPath, "utf8"));

  // 1. The router loads and validates the Python-generated artifact unchanged.
  const { artifact, graphArtifactHash } = loadGraphArtifact(parsed);

  // 2. A selection runs over it.
  const config = DEFAULT_SELECTOR_CONFIG;
  const selectionResult = selectContext({ graph: artifact, task, config });

  // 3. A receipt is built and signed (deterministic seed/timestamp/id).
  const privateKey = ed25519PrivateKeyFromSeed("00".repeat(32));
  const receipt = buildReceipt({
    selectionResult,
    repository: {
      origin: artifact.metadata.provenance.repository_origin,
      commit_sha: artifact.metadata.provenance.commit_sha,
      tree_hash: artifact.metadata.provenance.tree_hash,
    },
    taskText: task,
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
    timestamp: "2026-06-21T00:00:00.000Z",
    taskId: "00000000-0000-0000-0000-000000000000",
  });

  // 4. verify returns PASS.
  const outcome = verifyReceipt(receipt, {
    graph: parsed,
    taskText: task,
    config,
    manualInclude: [],
  });

  if (outcome.pass) {
    console.log(`PASS ${receipt.receipt_hash}`);
    process.exit(0);
  }
  console.error(`FAIL ${outcome.field}: ${outcome.detail}`);
  process.exit(1);
}

main();
