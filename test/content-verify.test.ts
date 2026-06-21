/**
 * Content re-verification gate — SPEC §6.4, PR 4.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { loadGraphArtifact } from "../src/graph/index.js";
import { loadSelectorConfig } from "../src/config/index.js";
import { selectContext, verifySelectionContent } from "../src/pipeline/index.js";
import { ContentDriftError } from "../src/errors.js";

const dir = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

const graph = loadGraphArtifact(
  JSON.parse(readFileSync(new URL("./fixtures/content/graph.json", import.meta.url), "utf8")) as unknown,
).artifact;

// Task "alpha beta" makes both files entrypoints by filename match.
const selection = selectContext({ graph, task: "alpha beta", config: loadSelectorConfig() }).selection;

describe("content re-verification (§6.4)", () => {
  it("selects both fixture files", () => {
    expect(selection.map((f) => f.path).sort()).toEqual(["alpha.ts", "beta.ts"]);
  });

  it("passes when content matches the recorded hashes", () => {
    expect(() =>
      verifySelectionContent(selection, dir("./fixtures/content/repo")),
    ).not.toThrow();
  });

  it("aborts with `content drift <path>` on a mutated file", () => {
    expect(() =>
      verifySelectionContent(selection, dir("./fixtures/content/repo-drift")),
    ).toThrow(ContentDriftError);
    try {
      verifySelectionContent(selection, dir("./fixtures/content/repo-drift"));
      expect.unreachable("expected content drift");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentDriftError);
      expect((error as ContentDriftError).message).toBe("content drift alpha.ts");
      expect((error as ContentDriftError).path).toBe("alpha.ts");
    }
  });

  it("treats a missing file as drift", () => {
    expect(() =>
      verifySelectionContent([{ path: "gone.ts", content_hash: "00" }], dir("./fixtures/content/repo")),
    ).toThrow(/content drift gone\.ts/);
  });
});
