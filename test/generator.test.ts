/**
 * TypeScript/JavaScript graph generator — SPEC §4 producer side, PR 7.
 *
 * Runs against a fixture project with a known alias (`@/utils`) and a known
 * dynamic template import. Asserts the unresolved edge is emitted (not dropped)
 * and that the output passes the PR 1 loader.
 */

import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { loadGraphArtifact } from "../src/graph/index.js";
import { isUnresolvedEdge } from "../src/graph/index.js";
import { generateGraph } from "../src/generator/index.js";

const projectRoot = fileURLToPath(new URL("./fixtures/generator/project", import.meta.url));

const loaded = generateGraph({
  projectRoot,
  tsconfigPath: `${projectRoot}/tsconfig.json`,
  repositoryOrigin: "github.com/org/repo",
  commitSha: "4b825dc642cb6eb9a00b213b2e3fc7e42d99217c",
  trackedFiles: ["src/index.ts", "src/utils.ts", "tsconfig.json"],
  generatedAt: "2026-06-21T00:00:00.000Z",
});
const { artifact } = loaded;

describe("graph generator (§4)", () => {
  it("indexes project source files with content hash and token count", () => {
    expect(Object.keys(artifact.nodes).sort()).toEqual(["src/index.ts", "src/utils.ts"]);
    const utils = artifact.nodes["src/utils.ts"];
    expect(utils?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(utils?.token_count).toBeGreaterThan(0);
    expect(utils?.exports).toEqual(["helper", "util"]);
  });

  it("resolves a tsconfig path alias to a project file (resolved edge)", () => {
    const aliasEdge = artifact.edges.find(
      (e) => e.source === "src/index.ts" && !isUnresolvedEdge(e) && e.target === "src/utils.ts",
    );
    expect(aliasEdge).toBeDefined();
    expect(aliasEdge?.type).toBe("STATIC_IMPORT");
  });

  it("emits the dynamic template import as a first-class unresolved edge", () => {
    const dynamic = artifact.edges.filter(isUnresolvedEdge).find(
      (e) => e.resolution_error === "dynamic_template_literal",
    );
    expect(dynamic).toBeDefined();
    expect(dynamic?.target).toBeNull();
    expect(dynamic?.type).toBe("DYNAMIC_IMPORT");
    expect(dynamic?.raw_specifier).toContain("./plugins/");
  });

  it("marks an uninstalled bare import as external_boundary", () => {
    const external = artifact.edges.filter(isUnresolvedEdge).find(
      (e) => e.raw_specifier === "some-external-lib",
    );
    expect(external?.resolution_error).toBe("external_boundary");
  });

  it("reports coverage honestly", () => {
    expect(artifact.metadata.coverage?.files_indexed).toBe(2);
    expect(artifact.metadata.coverage?.unresolved_edges).toBeGreaterThanOrEqual(2);
    expect(artifact.metadata.completeness).toBe("partial");
    expect(artifact.metadata.resolver_stack?.[0]?.name).toBe("typescript");
  });

  it("produces output that passes the PR 1 loader", () => {
    const reloaded = loadGraphArtifact(artifact);
    expect(reloaded.graphArtifactHash).toBe(loaded.graphArtifactHash);
    expect(reloaded.graphArtifactHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
