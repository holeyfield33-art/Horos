/**
 * Horos verify runner — drives the TS receipt verifier (dist/) against a
 * receipt, graph artifact, and task text supplied as inline JSON objects.
 *
 * This is the tool third-party auditors use: they provide a receipt + the graph
 * it was produced from + the original task text, and get back PASS or FAIL with
 * the exact diverging field on failure.  No repository clone is required.
 *
 * Usage: node verify_runner.mjs <request.json>
 *   request.json = {
 *     "receipt":         receipt object          (required)
 *     "graph":           graph artifact object   (required)
 *     "task":            task text string        (required)
 *     "manual_include":  string[]               (optional; defaults to [])
 *   }
 *
 * On PASS:  prints { ok: true,  pass: true }                           exits 0
 * On FAIL:  prints { ok: true,  pass: false, field: "...", detail: "..." } exits 0
 * On error: prints { ok: false, error: "..." }                         exits 1
 *
 * dist/ is located via $HOROS_DIST, else ../dist relative to this file.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = pathToFileURL(resolve(process.env.HOROS_DIST ?? resolve(here, "../dist"))).href;

function emitFail(error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error) }));
  process.exit(1);
}

async function main() {
  const requestPath = process.argv[2];
  if (requestPath === undefined) {
    emitFail("usage: node verify_runner.mjs <request.json>");
  }

  let request;
  try {
    request = JSON.parse(readFileSync(requestPath, "utf8"));
  } catch (e) {
    emitFail(`unreadable request: ${e.message}`);
  }

  const { receipt, graph, task, manual_include: manualInclude = [] } = request;
  if (
    typeof receipt !== "object" || receipt === null ||
    typeof graph !== "object" || graph === null ||
    typeof task !== "string"
  ) {
    emitFail("request requires: receipt (object), graph (object), task (string)");
  }

  const { loadGraphArtifact } = await import(`${distRoot}/graph/index.js`);
  const { verifyReceipt } = await import(`${distRoot}/verify/index.js`);
  const { DEFAULT_SELECTOR_CONFIG } = await import(`${distRoot}/config/index.js`);

  let artifact;
  try {
    ({ artifact } = loadGraphArtifact(graph));
  } catch (e) {
    emitFail(`graph load failed: ${e?.message ?? String(e)}`);
  }

  const outcome = verifyReceipt(receipt, {
    graph: artifact,
    taskText: task,
    config: DEFAULT_SELECTOR_CONFIG,
    manualInclude: Array.isArray(manualInclude) ? manualInclude : [],
  });

  if (outcome.pass) {
    process.stdout.write(JSON.stringify({ ok: true, pass: true }));
  } else {
    process.stdout.write(
      JSON.stringify({ ok: true, pass: false, field: outcome.field, detail: outcome.detail }),
    );
  }
}

main().catch((e) => emitFail(e?.message ?? String(e)));
