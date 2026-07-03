/**
 * Horos generate runner — drives the TS graph generator (dist/) for a
 * TypeScript/JavaScript project and writes the artifact to an output file.
 *
 * This is the counterpart to router_runner.mjs for the generation step.  It is
 * invoked by the Python MCP server (horos_mcp.router) when it detects a
 * TypeScript repository (tsconfig.json present, horos.json absent).
 *
 * Usage: node generate_runner.mjs <request.json>
 *   request.json = {
 *     "tsconfig":      absolute path to tsconfig.json    (required)
 *     "repo":          project root / workspace path     (required)
 *     "origin":        repository origin URL             (required)
 *     "commit":        commit SHA                        (required)
 *     "generated_at":  ISO-8601 timestamp                (required)
 *     "out":           absolute path for graph JSON      (required)
 *   }
 *
 * On success: prints { ok: true } to stdout and exits 0.
 * On failure: prints { ok: false, error: "..." } to stdout and exits 1.
 *
 * dist/ is located via $HOROS_DIST, else ../dist relative to this file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = process.env.HOROS_DIST ?? resolve(here, "../dist");

function emitFail(error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error) }));
  process.exit(1);
}

async function main() {
  const requestPath = process.argv[2];
  if (requestPath === undefined) {
    emitFail("usage: node generate_runner.mjs <request.json>");
  }

  let request;
  try {
    request = JSON.parse(readFileSync(requestPath, "utf8"));
  } catch (e) {
    emitFail(`unreadable request: ${e.message}`);
  }

  const { tsconfig, repo, origin, commit, generated_at: generatedAt, out } = request;
  if (
    typeof tsconfig !== "string" ||
    typeof repo !== "string" ||
    typeof origin !== "string" ||
    typeof commit !== "string" ||
    typeof generatedAt !== "string" ||
    typeof out !== "string"
  ) {
    emitFail("request missing required fields: tsconfig, repo, origin, commit, generated_at, out");
  }

  const { generateGraph } = await import(`${distRoot}/generator/index.js`);

  let artifact;
  try {
    ({ artifact } = generateGraph({
      projectRoot: repo,
      tsconfigPath: tsconfig,
      repositoryOrigin: origin,
      commitSha: commit,
      generatedAt,
    }));
  } catch (e) {
    emitFail(`graph generation failed: ${e?.message ?? String(e)}`);
  }

  try {
    writeFileSync(out, JSON.stringify(artifact), "utf8");
  } catch (e) {
    emitFail(`failed to write graph: ${e?.message ?? String(e)}`);
  }

  process.stdout.write(JSON.stringify({ ok: true }));
}

main().catch((e) => emitFail(e?.message ?? String(e)));
