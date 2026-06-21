/**
 * Selection pipeline golden tests — SPEC §6.1–6.3, PR 3.
 *
 * Each fixture graph + task yields the exact expected file set, ranking, and
 * coverage. Specific assertions cover decisions 4 and 9: an unresolved edge must
 * surface in unresolved_symbols, and a budget-truncated file must appear in
 * exclusions, never be dropped silently.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { loadGraphArtifact } from "../src/graph/index.js";
import { loadSelectorConfig } from "../src/config/index.js";
import { selectContext, type SelectionResult } from "../src/pipeline/index.js";

function read(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/pipeline/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

const basicGraph = loadGraphArtifact(read("basic-graph.json")).artifact;
const basicGolden = read("basic.golden.json") as { task: string; result: SelectionResult };
const budgetGolden = read("budget.golden.json") as {
  task: string;
  max_files: number;
  result: SelectionResult;
};

describe("selection pipeline (§6.1-6.3)", () => {
  it("reproduces the basic golden exactly", () => {
    const result = selectContext({
      graph: basicGraph,
      task: basicGolden.task,
      config: loadSelectorConfig(),
    });
    expect(result).toEqual(basicGolden.result);
  });

  it("is deterministic across runs", () => {
    const a = selectContext({ graph: basicGraph, task: basicGolden.task, config: loadSelectorConfig() });
    const b = selectContext({ graph: basicGraph, task: basicGolden.task, config: loadSelectorConfig() });
    expect(a).toEqual(b);
  });

  it("ranks by score desc then path byte order", () => {
    const result = selectContext({
      graph: basicGraph,
      task: basicGolden.task,
      config: loadSelectorConfig(),
    });
    expect(result.selection.map((f) => f.path)).toEqual([
      "src/auth/session.ts",
      "src/db.ts",
      "src/auth/jwt.ts",
    ]);
    expect(result.selection.map((f) => f.rank)).toEqual([1, 2, 3]);
  });

  it("surfaces an unresolved edge in unresolved_symbols (decision 9)", () => {
    const result = selectContext({
      graph: basicGraph,
      task: basicGolden.task,
      config: loadSelectorConfig(),
    });
    expect(result.coverage.unresolved_symbols).toContain("@/plugins/${name}");
    // The unresolved edge is not present in the selected file set.
    expect(result.selection.map((f) => f.path)).not.toContain(null);
  });

  it("records a budget-truncated file in exclusions, not dropped (decision 4)", () => {
    const result = selectContext({
      graph: basicGraph,
      task: budgetGolden.task,
      config: loadSelectorConfig({ ranking_strategy: { max_files: budgetGolden.max_files } }),
    });
    expect(result).toEqual(budgetGolden.result);
    expect(result.selection).toHaveLength(2);
    const truncated = result.exclusions.find((e) => e.reason_code === "BUDGET_TRUNCATED");
    expect(truncated?.path).toBe("src/auth/jwt.ts");
  });

  it("excludes test files heuristically with a reason code", () => {
    const result = selectContext({
      graph: basicGraph,
      task: basicGolden.task,
      config: loadSelectorConfig(),
    });
    const testExclusion = result.exclusions.find((e) => e.path === "src/auth/jwt.test.ts");
    expect(testExclusion?.reason_code).toBe("HEURISTIC_IGNORE_TESTS");
    expect(result.selection.map((f) => f.path)).not.toContain("src/auth/jwt.test.ts");
  });
});
