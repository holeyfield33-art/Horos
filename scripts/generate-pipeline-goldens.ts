/**
 * Generate frozen golden outputs for the selection pipeline (PR 3).
 * Run with: npx tsx scripts/generate-pipeline-goldens.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadGraphArtifact } from "../src/graph/index.js";
import { loadSelectorConfig } from "../src/config/index.js";
import { selectContext } from "../src/pipeline/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "test", "fixtures", "pipeline");

function readGraph(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

const TASK = "fix the auth session";

const basic = loadGraphArtifact(readGraph("basic-graph.json"));
const basicResult = selectContext({
  graph: basic.artifact,
  task: TASK,
  config: loadSelectorConfig(),
});

const budgetResult = selectContext({
  graph: basic.artifact,
  task: TASK,
  config: loadSelectorConfig({ ranking_strategy: { max_files: 2 } }),
});

const write = (name: string, value: unknown): void => {
  writeFileSync(join(fixtures, name), JSON.stringify(value, null, 2) + "\n", "utf8");
};

write("basic.golden.json", { task: TASK, result: basicResult });
write("budget.golden.json", { task: TASK, max_files: 2, result: budgetResult });
process.stdout.write("wrote pipeline goldens\n");
