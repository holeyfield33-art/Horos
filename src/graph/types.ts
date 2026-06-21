/**
 * Dependency graph artifact types — SPEC §4.
 *
 * The artifact is the interface between the repo's build/CI (which generates it)
 * and the router (which consumes and hashes it). The router never generates it.
 * Unresolved edges (`target: null`) are first-class members of the edge list.
 */

import type { EdgeType, ResolutionError } from "../enums.js";

export interface GeneratorInfo {
  readonly name: string;
  readonly version: string;
  readonly command_executed?: string;
  readonly execution_mode?: string;
}

export interface Provenance {
  readonly repository_origin: string;
  readonly commit_sha: string;
  readonly tree_hash: string;
  readonly generated_at: string;
}

export interface ResolverStackEntry {
  readonly name: string;
  readonly version: string;
}

export interface GraphCoverage {
  readonly files_total: number;
  readonly files_indexed: number;
  readonly edges_total: number;
  readonly unresolved_edges: number;
}

export interface GraphMetadata {
  readonly graph_id?: string;
  readonly generator: GeneratorInfo;
  readonly config_hash?: string;
  readonly provenance: Provenance;
  readonly resolver_stack?: readonly ResolverStackEntry[];
  readonly coverage?: GraphCoverage;
  readonly completeness?: string;
}

export interface GraphNode {
  readonly file_path?: string;
  readonly language?: string;
  /** Mandatory (§4). SHA-256 of the file content as hex. */
  readonly content_hash: string;
  /** Mandatory (§4). */
  readonly token_count: number;
  /** Optional (§4). Required for the exported-symbol entrypoint rule (§6.1). */
  readonly exports?: readonly string[];
}

export interface ResolvedEdge {
  readonly source: string;
  readonly target: string;
  readonly type: EdgeType;
  readonly resolved: true;
  readonly line?: number;
}

export interface UnresolvedEdge {
  readonly source: string;
  readonly target: null;
  readonly type: EdgeType;
  readonly resolved: false;
  readonly raw_specifier?: string;
  readonly resolution_error: ResolutionError;
  readonly line?: number;
}

export type GraphEdge = ResolvedEdge | UnresolvedEdge;

export interface GraphArtifact {
  readonly $schema: string;
  readonly metadata: GraphMetadata;
  readonly nodes: { readonly [path: string]: GraphNode };
  readonly edges: readonly GraphEdge[];
}

export function isUnresolvedEdge(edge: GraphEdge): edge is UnresolvedEdge {
  return edge.resolved === false;
}
