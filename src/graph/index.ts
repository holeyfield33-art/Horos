/** Graph artifact module — SPEC §4. */

export type {
  GraphArtifact,
  GraphMetadata,
  GraphNode,
  GraphEdge,
  ResolvedEdge,
  UnresolvedEdge,
  GeneratorInfo,
  Provenance,
  ResolverStackEntry,
  GraphCoverage,
} from "./types.js";
export { isUnresolvedEdge } from "./types.js";

export {
  loadGraphArtifact,
  loadGraphArtifactFile,
  readGraphArtifactFile,
  assertCommitMatch,
  type LoadedGraph,
} from "./loader.js";
