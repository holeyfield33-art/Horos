/**
 * cjson-backed hashes for the config, weight policy, graph artifact, and receipt
 * payload — SPEC §2.5 and §5.
 *
 * These are the thin "name -> bytes -> hash" bindings. The richer loaders and
 * validators that produce these inputs land in later PRs (graph loader in PR 1,
 * config loader in PR 2, receipt assembly in PR 5); PR 0 freezes the byte form.
 */

import { cjson, type CanonicalObject, type CanonicalValue } from "./cjson.js";
import { sha256 } from "./primitives.js";

/** `selector_config_hash`: sha256(cjson(selector_config)). */
export function selectorConfigHash(config: CanonicalValue): string {
  return sha256(cjson(config));
}

/**
 * `weight_policy_hash`: sha256(cjson(edge_weights)). Covers only the edge-weight
 * table so a ranking dispute resolves to exactly that table (SPEC §2.5).
 */
export function weightPolicyHash(edgeWeights: CanonicalValue): string {
  return sha256(cjson(edgeWeights));
}

/** `graph_artifact_hash`: sha256(cjson(graph)). */
export function graphArtifactHash(graph: CanonicalValue): string {
  return sha256(cjson(graph));
}

const RECEIPT_HASH_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "receipt_hash",
  "signature",
]);

/**
 * The receipt payload reduced to the fields that feed `receipt_hash`: everything
 * except `receipt_hash` and `signature` (SPEC §5).
 */
export function canonicalReceiptPayload(payload: CanonicalObject): CanonicalObject {
  const out: { [key: string]: CanonicalValue } = {};
  for (const key of Object.keys(payload)) {
    if (RECEIPT_HASH_EXCLUDED_KEYS.has(key)) continue;
    const value = payload[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** `receipt_hash`: sha256(cjson(payload excluding receipt_hash and signature)). */
export function receiptPayloadHash(payload: CanonicalObject): string {
  return sha256(cjson(canonicalReceiptPayload(payload)));
}
