/**
 * Manual includes / `manual_include_hash` — SPEC §2.4.
 *
 * The manual-include list is sorted by byte order, serialized as cjson (an array
 * of strings), and SHA-256'd. This hash is one of the replay inputs (§5.3): a
 * change to manual includes changes the receipt hash.
 */

import { byteSorted } from "./bytes.js";
import { cjson, type CanonicalValue } from "./cjson.js";
import { sha256 } from "./primitives.js";

/** Canonical bytes for the manual-include list. */
export function manualIncludeBytes(paths: readonly string[]): Uint8Array {
  const sorted: CanonicalValue = byteSorted(paths);
  return cjson(sorted);
}

/** `manual_include_hash`: sha256(cjson(sorted_manual_includes)). */
export function manualIncludeHash(paths: readonly string[]): string {
  return sha256(manualIncludeBytes(paths));
}
