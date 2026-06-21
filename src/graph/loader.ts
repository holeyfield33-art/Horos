/**
 * Graph artifact loader, schema validation, and hard gates — SPEC §4.
 *
 * Validation is explicit and total: every required field is checked and every
 * enum value (`type`, `resolution_error`) must be recognized. Unknown enum
 * values are a hard failure, never a silent skip. After validation succeeds the
 * checked value is the typed `GraphArtifact`.
 */

import { existsSync, readFileSync } from "node:fs";

import { graphArtifactHash as hashGraph } from "../canonical/index.js";
import type { CanonicalValue } from "../canonical/index.js";
import { isEdgeType, isResolutionError } from "../enums.js";
import {
  CommitMismatchError,
  GraphArtifactRequiredError,
  SchemaValidationError,
} from "../errors.js";
import type { GraphArtifact } from "./types.js";

const SCHEMA_PATTERN = /^context-graph-v(\d+)(?:\.(\d+))?$/;
const SUPPORTED_MAJOR = 0;

export interface LoadedGraph {
  readonly artifact: GraphArtifact;
  readonly graphArtifactHash: string;
}

function fail(path: string, detail: string): never {
  throw new SchemaValidationError(`${path}: ${detail}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(path, "expected an object");
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "expected a string");
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "expected a finite number");
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function validateSchemaVersion(schema: string): void {
  const match = SCHEMA_PATTERN.exec(schema);
  if (match === null) fail("$schema", `unrecognized schema id "${schema}"`);
  const major = Number(match[1]);
  if (major !== SUPPORTED_MAJOR) {
    fail("$schema", `unsupported schema major version "${schema}" (router supports v${String(SUPPORTED_MAJOR)})`);
  }
  // A higher minor version is accepted (forward compatible). An unknown enum
  // value encountered below is what actually rejects an incompatible artifact.
}

function validateNode(value: unknown, path: string): void {
  const node = requireObject(value, path);
  requireString(node["content_hash"], `${path}.content_hash`);
  requireNumber(node["token_count"], `${path}.token_count`);
  if (node["exports"] !== undefined) {
    if (!Array.isArray(node["exports"])) fail(`${path}.exports`, "expected an array");
    node["exports"].forEach((entry, i) =>
      requireString(entry, `${path}.exports[${String(i)}]`),
    );
  }
  if (node["file_path"] !== undefined) requireString(node["file_path"], `${path}.file_path`);
  if (node["language"] !== undefined) requireString(node["language"], `${path}.language`);
}

function validateEdge(value: unknown, path: string): void {
  const edge = requireObject(value, path);
  requireString(edge["source"], `${path}.source`);

  const type = requireString(edge["type"], `${path}.type`);
  if (!isEdgeType(type)) fail(`${path}.type`, `unknown edge type "${type}"`);

  const resolved = requireBoolean(edge["resolved"], `${path}.resolved`);

  if (resolved) {
    requireString(edge["target"], `${path}.target`);
    if (edge["resolution_error"] !== undefined) {
      fail(`${path}.resolution_error`, "resolved edge must not carry resolution_error");
    }
  } else {
    if (edge["target"] !== null) fail(`${path}.target`, "unresolved edge target must be null");
    const resolutionError = requireString(edge["resolution_error"], `${path}.resolution_error`);
    if (!isResolutionError(resolutionError)) {
      fail(`${path}.resolution_error`, `unknown resolution_error "${resolutionError}"`);
    }
    if (edge["raw_specifier"] !== undefined) {
      requireString(edge["raw_specifier"], `${path}.raw_specifier`);
    }
  }

  if (edge["line"] !== undefined) requireNumber(edge["line"], `${path}.line`);
}

function validateMetadata(value: unknown): void {
  const metadata = requireObject(value, "metadata");

  const generator = requireObject(metadata["generator"], "metadata.generator");
  requireString(generator["name"], "metadata.generator.name");
  requireString(generator["version"], "metadata.generator.version");

  const provenance = requireObject(metadata["provenance"], "metadata.provenance");
  requireString(provenance["repository_origin"], "metadata.provenance.repository_origin");
  requireString(provenance["commit_sha"], "metadata.provenance.commit_sha");
  requireString(provenance["tree_hash"], "metadata.provenance.tree_hash");
  requireString(provenance["generated_at"], "metadata.provenance.generated_at");
}

function validateGraphArtifact(value: unknown): void {
  const root = requireObject(value, "<root>");
  validateSchemaVersion(requireString(root["$schema"], "$schema"));
  validateMetadata(root["metadata"]);

  const nodes = requireObject(root["nodes"], "nodes");
  for (const [key, node] of Object.entries(nodes)) {
    validateNode(node, `nodes[${JSON.stringify(key)}]`);
  }

  const edges = root["edges"];
  if (!Array.isArray(edges)) fail("edges", "expected an array");
  edges.forEach((edge, i) => validateEdge(edge, `edges[${String(i)}]`));
}

/** Validate and load a parsed graph artifact, computing its canonical hash. */
export function loadGraphArtifact(input: unknown): LoadedGraph {
  validateGraphArtifact(input);
  // `input` is plain parsed JSON; hash the supplied value so a verifier parsing
  // the same bytes computes the same hash regardless of our typed view.
  const graphArtifactHash = hashGraph(input as CanonicalValue);
  return { artifact: input as GraphArtifact, graphArtifactHash };
}

/**
 * Read a graph artifact from disk. A missing path or missing file is the hard
 * gate of §4: "graph artifact required" — and no receipt may be emitted.
 */
export function readGraphArtifactFile(path: string | undefined): unknown {
  if (path === undefined || path === "" || !existsSync(path)) {
    throw new GraphArtifactRequiredError("graph artifact required");
  }
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SchemaValidationError(`graph artifact is not valid JSON: ${detail}`);
  }
}

/** Convenience: read, validate, and hash a graph artifact file (with §4 gate). */
export function loadGraphArtifactFile(path: string | undefined): LoadedGraph {
  return loadGraphArtifact(readGraphArtifactFile(path));
}

/**
 * Hard gate (§4): abort when the graph's recorded `commit_sha` does not match
 * the repository HEAD being routed.
 */
export function assertCommitMatch(artifact: GraphArtifact, repoHeadSha: string): void {
  const graphSha = artifact.metadata.provenance.commit_sha;
  if (graphSha !== repoHeadSha) {
    throw new CommitMismatchError(
      `commit_sha mismatch: graph ${graphSha} != repo HEAD ${repoHeadSha}`,
    );
  }
}
