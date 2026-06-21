/**
 * Receipt types — SPEC §5. Object types are `type` aliases so the whole receipt
 * is assignable to CanonicalValue and hashes through the PR 0 serializer.
 */

import type { TaskClass } from "../enums.js";
import type { Coverage, Exclusion, SelectedFile } from "../pipeline/index.js";

export type ReceiptRepository = {
  readonly origin: string;
  readonly commit_sha: string;
  readonly tree_hash: string;
};

export type ReceiptTask = {
  readonly task_hash: string;
  readonly task_class: TaskClass;
};

export type ReceiptSelector = {
  readonly version: string;
  readonly config_hash: string;
  readonly weight_policy_hash: string;
};

export type ReceiptGraph = {
  readonly graph_artifact_hash: string;
  readonly graph_generator: { readonly name: string; readonly version: string };
  readonly graph_supplied_externally: boolean;
};

export type ReceiptSignature = {
  readonly algorithm: string;
  readonly public_key: string;
  readonly value: string;
};

export type Receipt = {
  readonly version: string;
  readonly timestamp: string;
  readonly task_id: string;
  readonly repository: ReceiptRepository;
  readonly task: ReceiptTask;
  readonly selector: ReceiptSelector;
  readonly graph: ReceiptGraph;
  readonly manual_include: readonly string[];
  readonly manual_include_hash: string;
  readonly selection: readonly SelectedFile[];
  readonly exclusions: readonly Exclusion[];
  readonly coverage: Coverage;
  readonly prev_receipt_hash: string | null;
  readonly receipt_hash: string;
  readonly signature: ReceiptSignature;
};

/** Thin chain-link object — SPEC §5.1. */
export type ChainLink = {
  readonly chain_id: string;
  readonly seq: number;
  readonly prev_receipt_hash: string | null;
  readonly receipt_hash: string;
  readonly signature: string;
};
