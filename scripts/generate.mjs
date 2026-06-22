/**
 * Generate a context-graph-v0 artifact from a TypeScript/JavaScript project.
 *
 * Usage:
 *   node scripts/generate.mjs --tsconfig <path> [--repo <dir>]
 *       [--origin <url>] [--commit <sha>] [--out <file>]
 *
 * --tsconfig  path to tsconfig.json (required)
 * --repo      project root; defaults to directory of tsconfig
 * --origin    repository origin URL recorded in the artifact
 * --commit    commit SHA recorded in the artifact (default: git HEAD)
 * --out       output file; default stdout
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { generateGraph } = await import(`${here}/../dist/generator/index.js`);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tsconfig") opts.tsconfig = argv[++i];
    else if (argv[i] === "--repo") opts.repo = argv[++i];
    else if (argv[i] === "--origin") opts.origin = argv[++i];
    else if (argv[i] === "--commit") opts.commit = argv[++i];
    else if (argv[i] === "--out") opts.out = argv[++i];
    else { process.stderr.write(`unknown option: ${argv[i]}\n`); process.exit(2); }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.tsconfig) {
  process.stderr.write("error: --tsconfig is required\n");
  process.exit(2);
}

const tsconfigPath = resolve(opts.tsconfig);
const projectRoot = resolve(opts.repo ?? dirname(tsconfigPath));

let commitSha = opts.commit;
if (!commitSha) {
  try {
    commitSha = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    commitSha = "0000000000000000000000000000000000000000";
  }
}

const { artifact } = generateGraph({
  projectRoot,
  tsconfigPath,
  repositoryOrigin: opts.origin ?? `local:${projectRoot}`,
  commitSha,
});

const json = JSON.stringify(artifact, null, 2);
if (opts.out) {
  writeFileSync(opts.out, json, "utf8");
  process.stderr.write(`graph written to ${opts.out}\n`);
} else {
  process.stdout.write(json + "\n");
}
