/**
 * Graph artifact loader, validation, and hard gates — SPEC §4, PR 1.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import {
  loadGraphArtifact,
  loadGraphArtifactFile,
  readGraphArtifactFile,
  assertCommitMatch,
  isUnresolvedEdge,
} from "../src/graph/index.js";
import {
  GraphArtifactRequiredError,
  SchemaValidationError,
  CommitMismatchError,
} from "../src/errors.js";

const fixtureUrl = new URL("./fixtures/graph/valid-graph.json", import.meta.url);
const fixturePath = fixtureUrl.pathname;
const HEAD = "4b825dc642cb6eb9a00b213b2e3fc7e42d99217c";

function validGraph(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixtureUrl, "utf8")) as Record<string, unknown>;
}

describe("graph loader (§4)", () => {
  it("loads a valid fixture and computes a stable hash", () => {
    const a = loadGraphArtifact(validGraph());
    const b = loadGraphArtifact(validGraph());
    expect(a.graphArtifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.graphArtifactHash).toBe(b.graphArtifactHash);
    expect(a.artifact.$schema).toBe("context-graph-v0");
    expect(Object.keys(a.artifact.nodes)).toContain("src/auth/session.ts");
  });

  it("loads from a file", () => {
    const loaded = loadGraphArtifactFile(fixturePath);
    expect(loaded.artifact.metadata.provenance.commit_sha).toBe(HEAD);
  });

  it("keeps unresolved edges as first-class members", () => {
    const { artifact } = loadGraphArtifact(validGraph());
    const unresolved = artifact.edges.filter(isUnresolvedEdge);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.target).toBeNull();
    expect(unresolved[0]?.resolution_error).toBe("dynamic_template_literal");
    expect(unresolved[0]?.raw_specifier).toBe("@/utils/${strategy}");
  });
});

describe("hard gates (§4)", () => {
  it("missing artifact path -> graph artifact required (no receipt)", () => {
    expect(() => readGraphArtifactFile(undefined)).toThrow(GraphArtifactRequiredError);
    expect(() => readGraphArtifactFile("")).toThrow(GraphArtifactRequiredError);
    expect(() => readGraphArtifactFile("/no/such/graph.json")).toThrow(
      /graph artifact required/,
    );
  });

  it("commit_sha mismatch aborts", () => {
    const { artifact } = loadGraphArtifact(validGraph());
    expect(() => assertCommitMatch(artifact, "deadbeef")).toThrow(CommitMismatchError);
    expect(() => assertCommitMatch(artifact, HEAD)).not.toThrow();
  });
});

describe("schema validation (§4)", () => {
  it("rejects an unknown edge type", () => {
    const g = validGraph();
    (g["edges"] as Array<Record<string, unknown>>)[0]!["type"] = "WAT_IMPORT";
    expect(() => loadGraphArtifact(g)).toThrow(SchemaValidationError);
    expect(() => loadGraphArtifact(g)).toThrow(/unknown edge type/);
  });

  it("rejects an unknown resolution_error", () => {
    const g = validGraph();
    (g["edges"] as Array<Record<string, unknown>>)[1]!["resolution_error"] = "wat";
    expect(() => loadGraphArtifact(g)).toThrow(/unknown resolution_error/);
  });

  it("rejects an unresolved edge whose target is not null", () => {
    const g = validGraph();
    (g["edges"] as Array<Record<string, unknown>>)[1]!["target"] = "src/x.ts";
    expect(() => loadGraphArtifact(g)).toThrow(/target must be null/);
  });

  it("rejects a node missing content_hash", () => {
    const g = validGraph();
    const nodes = g["nodes"] as Record<string, Record<string, unknown>>;
    delete nodes["src/index.ts"]!["content_hash"];
    expect(() => loadGraphArtifact(g)).toThrow(/content_hash/);
  });

  it("rejects an unsupported schema major version", () => {
    const g = validGraph();
    g["$schema"] = "context-graph-v1";
    expect(() => loadGraphArtifact(g)).toThrow(/major version/);
  });

  it("accepts a higher minor version", () => {
    const g = validGraph();
    g["$schema"] = "context-graph-v0.3";
    expect(() => loadGraphArtifact(g)).not.toThrow();
  });

  it("rejects invalid JSON from a file", () => {
    const badPath = new URL("./fixtures/graph/not-json.txt", import.meta.url);
    expect(() => readGraphArtifactFile(badPath.pathname)).toThrow(SchemaValidationError);
    expect(() => readGraphArtifactFile(badPath.pathname)).toThrow(/not valid JSON/);
  });
});
