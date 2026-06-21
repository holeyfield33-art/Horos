/**
 * Selection pipeline output types — SPEC §5 (selection, exclusions, coverage).
 * These are receipt-ready: PR 5 assembles a receipt directly from a
 * SelectionResult plus provenance hashes.
 */

import type { ReasonCode } from "../enums.js";

export type SelectedFile = {
  readonly path: string;
  readonly content_hash: string;
  readonly token_count: number;
  readonly rule: string;
  readonly rule_evidence: readonly string[];
  readonly rank: number;
};

export type Exclusion = {
  readonly path: string;
  readonly reason_code: ReasonCode;
};

export type Coverage = {
  readonly files_scanned: number;
  readonly files_selected: number;
  readonly entrypoints: readonly string[];
  readonly unresolved_symbols: readonly string[];
  readonly excluded_candidates: readonly string[];
  readonly graph_frontier_size: number;
};

export type SelectionResult = {
  readonly selection: readonly SelectedFile[];
  readonly exclusions: readonly Exclusion[];
  readonly coverage: Coverage;
};
