/**
 * Horos MCP router runner — drives the UNCHANGED TS router (dist/) over a
 * Python-generated graph artifact and emits a structured JSON result for the
 * Python MCP server to shape into the SPEC §3 response.
 *
 * This mirrors the P5 parity harness (python/graph-gen-python/tests/parity/
 * verify_parity.mjs) EXACTLY — loadGraphArtifact → selectContext → buildReceipt
 * → verifyReceipt — using the same deterministic seed/timestamp/task-id so the
 * same repo+ref+config yields an identical receipt_hash. It re-implements
 * nothing in the router and modifies neither the router nor the parity script.
 *
 * Usage: node router_runner.mjs <request.json>
 *   request.json = { "graph_path": "...", "task": "...", "manual_include": [] }
 *
 * On a verified receipt: prints a JSON object with `ok:true` and exits 0.
 * On any failure (including a receipt that does not verify): prints
 * `{ ok:false, error, field, detail }` and exits 1.
 *
 * dist/ is located via $HOROS_DIST, else ../dist relative to this file.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = process.env.HOROS_DIST ?? resolve(here, "../dist");

// Deterministic receipt inputs — identical to the parity harness.
const SEED = "00".repeat(32);
const TIMESTAMP = "2026-06-21T00:00:00.000Z";
const TASK_ID = "00000000-0000-0000-0000-000000000000";
const TASK_CLASS = "feature";

function emitFail(error, field, detail) {
  process.stdout.write(JSON.stringify({ ok: false, error, field: field ?? null, detail: detail ?? null }));
  process.exit(1);
}

async function main() {
  const requestPath = process.argv[2];
  if (requestPath === undefined) {
    emitFail("router_failed", "argv", "usage: node router_runner.mjs <request.json>");
  }

  let request;
  try {
    request = JSON.parse(readFileSync(requestPath, "utf8"));
  } catch (e) {
    emitFail("router_failed", "request", `unreadable request: ${e.message}`);
  }

  const { graph_path: graphPath, task, manual_include: manualInclude = [] } = request;
  if (typeof graphPath !== "string" || typeof task !== "string") {
    emitFail("router_failed", "request", "graph_path and task are required strings");
  }

  const parsed = JSON.parse(readFileSync(graphPath, "utf8"));

  const { loadGraphArtifact } = await import(`${distRoot}/graph/index.js`);
  const { selectContext } = await import(`${distRoot}/pipeline/index.js`);
  const { buildReceipt } = await import(`${distRoot}/receipt/index.js`);
  const { verifyReceipt } = await import(`${distRoot}/verify/index.js`);
  const { DEFAULT_SELECTOR_CONFIG } = await import(`${distRoot}/config/index.js`);
  const { ed25519PrivateKeyFromSeed } = await import(`${distRoot}/canonical/index.js`);

  // 1. Router loads + validates the Python-generated artifact, unchanged.
  const { artifact, graphArtifactHash } = loadGraphArtifact(parsed);

  // 2. Selection over the loaded graph.
  const config = DEFAULT_SELECTOR_CONFIG;
  const selectionResult = selectContext({ graph: artifact, task, config });

  // 3. Build + sign a deterministic receipt.
  const privateKey = ed25519PrivateKeyFromSeed(SEED);
  const receipt = buildReceipt({
    selectionResult,
    repository: {
      origin: artifact.metadata.provenance.repository_origin,
      commit_sha: artifact.metadata.provenance.commit_sha,
      tree_hash: artifact.metadata.provenance.tree_hash,
    },
    taskText: task,
    taskClass: TASK_CLASS,
    config,
    graphArtifactHash,
    graphGenerator: {
      name: artifact.metadata.generator.name,
      version: artifact.metadata.generator.version,
    },
    manualInclude,
    prevReceiptHash: null,
    privateKey,
    timestamp: TIMESTAMP,
    taskId: TASK_ID,
  });

  // 4. Verify — must PASS or the server refuses to return (the load-bearing invariant).
  const outcome = verifyReceipt(receipt, {
    graph: parsed,
    taskText: task,
    config,
    manualInclude,
  });
  if (!outcome.pass) {
    emitFail("router_failed", outcome.field, outcome.detail);
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      verified: true,
      receipt: {
        receipt_hash: receipt.receipt_hash,
        task_hash: receipt.task.task_hash,
        config_hash: receipt.selector.config_hash,
        graph_artifact_hash: receipt.graph.graph_artifact_hash,
      },
      repository: {
        commit_sha: receipt.repository.commit_sha,
        origin: receipt.repository.origin,
        tree_hash: receipt.repository.tree_hash,
      },
      selection: receipt.selection.map((s) => ({
        path: s.path,
        rank: s.rank,
        token_count: s.token_count,
      })),
      exclusions: receipt.exclusions.map((e) => ({
        path: e.path,
        reason_code: e.reason_code,
      })),
      coverage: {
        files_scanned: receipt.coverage.files_scanned,
        files_selected: receipt.coverage.files_selected,
        unresolved_symbols: receipt.coverage.unresolved_symbols,
      },
    }),
  );
}

main().catch((e) => emitFail("router_failed", "exception", e?.message ?? String(e)));
