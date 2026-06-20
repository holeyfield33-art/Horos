/**
 * Task normalization — SPEC §2.2.
 *
 * Pipeline (each step pinned; see DECISIONS.md for the case-folding pin):
 *   1. Unicode NFKC normalization.
 *   2. Case fold (v0.1 pins this to ECMAScript `String.prototype.toLowerCase`).
 *   3. Tokenize on Unicode letter/number runs: /[\p{L}\p{N}]+/gu
 *      (tokenization rule id "unicode-letters-numbers-v1").
 *   4. Remove stopwords using the committed, versioned list (stopwords-v1.json).
 *
 * The resulting token sequence (order preserved, duplicates kept) is serialized
 * as cjson — an array of strings — and SHA-256'd to produce `task_hash`.
 */

import { cjson, type CanonicalValue } from "./cjson.js";
import { sha256 } from "./primitives.js";
import {
  STOPWORDS as STOPWORD_LIST,
  STOPWORD_LIST_VERSION,
  TOKENIZATION_RULE,
} from "./stopwords-v1.js";

export { STOPWORD_LIST_VERSION, TOKENIZATION_RULE };

const STOPWORDS: ReadonlySet<string> = new Set(STOPWORD_LIST);

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

/**
 * Identifiers folded into `selector_config_hash` (SPEC §2.2: "The stopword list
 * and tokenization rule version are part of `selector_config_hash`.").
 */
export const TASK_NORMALIZATION_POLICY = {
  unicode_normalization: "NFKC",
  case_folding: "ecmascript-toLowerCase",
  tokenization_rule: TOKENIZATION_RULE,
  stopword_list_version: STOPWORD_LIST_VERSION,
} as const;

/** Normalize a raw task string into its canonical token sequence. */
export function normalizeTaskTokens(task: string): string[] {
  const folded = task.normalize("NFKC").toLowerCase();
  const matches = folded.match(TOKEN_PATTERN) ?? [];
  return matches.filter((token) => !STOPWORDS.has(token));
}

/** Canonical bytes hashed to produce `task_hash`: cjson of the token array. */
export function taskCanonicalBytes(task: string): Uint8Array {
  const tokens: CanonicalValue = normalizeTaskTokens(task);
  return cjson(tokens);
}

/** `task_hash` per SPEC §2.2 / §5: sha256(cjson(normalized_tokens)). */
export function taskHash(task: string): string {
  return sha256(taskCanonicalBytes(task));
}
