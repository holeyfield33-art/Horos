/**
 * Selection pipeline — SPEC §6.1–6.3, decisions 3/4/9.
 *
 *   normalize -> entrypoint discovery -> bounded BFS -> ranking ->
 *   budget enforcement -> coverage analysis
 *
 * Content re-verification (§6.4) is a separate gate added in PR 4; it is not part
 * of this module. Determinism is the contract: identical inputs yield an identical
 * file set, ranking, exclusions, and coverage. The exact entrypoint/BFS matching
 * semantics the spec leaves open are pinned here and in DECISIONS.md, versioned
 * through entrypoint_rules.version.
 */

import { normalizeTaskTokens } from "../canonical/index.js";
import { compareUtf8Bytes } from "../canonical/index.js";
import type { SelectorConfig } from "../config/index.js";
import { isUnresolvedEdge, type GraphArtifact, type GraphEdge } from "../graph/index.js";
import type { ReasonCode } from "../enums.js";
import {
  basename,
  dirSegments,
  fileStem,
  isBuildPath,
  isTestPath,
  normalizeForMatch,
  stabilizeScore,
  testSubjectStem,
} from "./paths.js";
import type { Coverage, Exclusion, SelectedFile, SelectionResult } from "./types.js";

export type SelectInput = {
  readonly graph: GraphArtifact;
  readonly task: string;
  readonly config: SelectorConfig;
};

type Mutable = {
  score: number;
  depth: number;
  isEntrypoint: boolean;
  evidence: string[];
};

const byPath = (a: { path: string }, b: { path: string }): number =>
  compareUtf8Bytes(a.path, b.path);

export function selectContext(input: SelectInput): SelectionResult {
  const { graph, task, config } = input;
  const nodePaths = Object.keys(graph.nodes);
  const nodeSet: ReadonlySet<string> = new Set(nodePaths);
  const tokens = new Set(normalizeTaskTokens(task));
  const rules = config.entrypoint_rules;
  const weights = config.ranking_strategy.edge_weights;
  const maxDepth = config.ranking_strategy.max_depth_hops;

  const state = new Map<string, Mutable>();
  const ensure = (path: string): Mutable => {
    let s = state.get(path);
    if (s === undefined) {
      s = { score: 0, depth: Number.POSITIVE_INFINITY, isEntrypoint: false, evidence: [] };
      state.set(path, s);
    }
    return s;
  };
  const add = (path: string, points: number, evidence: string): void => {
    const s = ensure(path);
    s.score = stabilizeScore(s.score + points);
    s.isEntrypoint = true;
    s.depth = 0;
    s.evidence.push(evidence);
  };

  // --- §6.1 entrypoint discovery (rules stack; ties break by path byte order) ---
  for (const path of nodePaths) {
    const node = graph.nodes[path];
    if (node === undefined) continue;

    const stem = normalizeForMatch(fileStem(path));
    if (tokens.has(stem)) add(path, rules.exact_filename_match, `exact_filename:${stem}`);

    for (const seg of dirSegments(path)) {
      const dir = normalizeForMatch(seg);
      if (tokens.has(dir)) {
        add(path, rules.containing_directory_match, `containing_directory:${dir}`);
        break;
      }
    }

    if (node.exports !== undefined) {
      for (const sym of node.exports) {
        if (tokens.has(normalizeForMatch(sym))) {
          add(path, rules.exported_symbol_match, `exported_symbol:${sym}`);
          break;
        }
      }
    }
  }

  // Test-pair: a test file whose subject matches a token boosts the *subject*.
  for (const path of nodePaths) {
    if (!isTestPath(path)) continue;
    const subjectStem = normalizeForMatch(testSubjectStem(path));
    if (!tokens.has(subjectStem)) continue;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    for (const candidate of nodePaths) {
      if (candidate === path || isTestPath(candidate)) continue;
      if (candidate.startsWith(dir) && normalizeForMatch(fileStem(candidate)) === subjectStem) {
        add(candidate, rules.test_pair_match, `test_pair:${basename(path)}`);
      }
    }
  }

  // Config-route bonus: a file referenced by a FRAMEWORK_ROUTE/CONFIG_REFERENCE
  // edge whose stem matches a token.
  const routeTargets = new Set<string>();
  for (const edge of graph.edges) {
    if (!isUnresolvedEdge(edge) && (edge.type === "FRAMEWORK_ROUTE" || edge.type === "CONFIG_REFERENCE")) {
      routeTargets.add(edge.target);
    }
  }
  for (const path of routeTargets) {
    if (!nodeSet.has(path)) continue;
    if (tokens.has(normalizeForMatch(fileStem(path)))) {
      add(path, rules.config_route_reference, "config_route_reference");
    }
  }

  // --- §6.2 graph expansion: bounded BFS via relaxation up to max_depth_hops ---
  const resolvedEdges = graph.edges.filter((e): e is Extract<GraphEdge, { resolved: true }> =>
    !isUnresolvedEdge(e),
  );
  const depthExceeded = new Set<string>();

  for (let round = 0; round < maxDepth; round += 1) {
    for (const edge of resolvedEdges) {
      const from = state.get(edge.source);
      if (from === undefined || from.depth >= maxDepth) continue;
      if (!nodeSet.has(edge.target)) continue;
      const weight = weights[edge.type];
      const candidate = stabilizeScore(from.score * weight);
      const nextDepth = from.depth + 1;
      const to = ensure(edge.target);
      const key = `edge:${edge.source}->${edge.target}:${edge.type}`;
      if (candidate > to.score) {
        to.score = candidate;
        to.depth = Math.min(to.depth, nextDepth);
        to.evidence = [key];
      } else if (candidate === to.score && to.depth === Number.POSITIVE_INFINITY) {
        to.depth = nextDepth;
        to.evidence.push(key);
      } else {
        to.depth = Math.min(to.depth, nextDepth);
      }
    }
  }

  // Identify nodes one hop beyond the depth budget (excluded candidates).
  for (const edge of resolvedEdges) {
    const from = state.get(edge.source);
    if (from === undefined || from.depth !== maxDepth) continue;
    if (!nodeSet.has(edge.target)) continue;
    if (!state.has(edge.target)) depthExceeded.add(edge.target);
  }

  // --- candidate set: reached within depth, score > 0 ---
  const visited = new Set<string>([...state.keys()].filter((p) => {
    const s = state.get(p);
    return s !== undefined && s.depth <= maxDepth && s.score > 0;
  }));

  // --- heuristic filters (decision 4: recorded, not silently dropped) ---
  const exclusionByPath = new Map<string, ReasonCode>();
  const setExclusion = (path: string, reason: ReasonCode): void => {
    if (!exclusionByPath.has(path)) exclusionByPath.set(path, reason);
  };

  const candidates: string[] = [];
  for (const path of visited) {
    if (isTestPath(path)) {
      setExclusion(path, "HEURISTIC_IGNORE_TESTS");
      continue;
    }
    if (isBuildPath(path)) {
      setExclusion(path, "HEURISTIC_IGNORE_BUILD");
      continue;
    }
    candidates.push(path);
  }
  for (const path of depthExceeded) {
    if (!visited.has(path)) setExclusion(path, "DEPTH_EXCEEDED");
  }

  // --- §6.2 ranking: score desc, then path byte order asc ---
  const ranked = candidates
    .map((path) => {
      const s = state.get(path);
      return { path, score: s?.score ?? 0 };
    })
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : compareUtf8Bytes(a.path, b.path)));

  // --- §6.3 budget enforcement: deterministic truncation ---
  const maxFiles = config.ranking_strategy.max_files;
  const maxTokens = config.ranking_strategy.max_tokens;
  const selection: SelectedFile[] = [];
  let runningTokens = 0;
  let truncated = false;
  for (const entry of ranked) {
    const node = graph.nodes[entry.path];
    if (node === undefined) continue;
    const tokenCount = node.token_count;
    if (
      truncated ||
      selection.length >= maxFiles ||
      runningTokens + tokenCount > maxTokens
    ) {
      truncated = true;
      setExclusion(entry.path, "BUDGET_TRUNCATED");
      continue;
    }
    runningTokens += tokenCount;
    const s = state.get(entry.path);
    selection.push({
      path: entry.path,
      content_hash: node.content_hash,
      token_count: tokenCount,
      rule: s?.isEntrypoint === true ? "entrypoint" : "import_walk",
      rule_evidence: s?.evidence ?? [],
      rank: selection.length + 1,
    });
  }

  // --- coverage analysis ---
  const selectedSet = new Set(selection.map((f) => f.path));

  const unresolvedSymbols = new Set<string>();
  let frontierSize = 0;
  for (const edge of graph.edges) {
    const from = state.get(edge.source);
    const sourceVisited = from !== undefined && from.score > 0 && from.depth <= maxDepth;
    if (!sourceVisited) continue;
    if (isUnresolvedEdge(edge)) {
      unresolvedSymbols.add(edge.raw_specifier ?? edge.resolution_error);
      frontierSize += 1;
    } else if (!selectedSet.has(edge.target)) {
      frontierSize += 1;
    }
  }

  const entrypoints = [...state.entries()]
    .filter(([, s]) => s.isEntrypoint && s.score > 0)
    .map(([path]) => path)
    .sort(compareUtf8Bytes);

  const exclusions: Exclusion[] = [...exclusionByPath.entries()]
    .map(([path, reason_code]) => ({ path, reason_code }))
    .sort(byPath);

  const coverage: Coverage = {
    files_scanned: nodePaths.length,
    files_selected: selection.length,
    entrypoints,
    unresolved_symbols: [...unresolvedSymbols].sort(compareUtf8Bytes),
    excluded_candidates: exclusions.map((e) => e.path),
    graph_frontier_size: frontierSize,
  };

  return { selection, exclusions, coverage };
}
