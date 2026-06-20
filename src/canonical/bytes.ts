/** Shared byte-ordering helper used by the manifest and manual-include forms. */

/** Compare two strings by their UTF-8 byte sequence, ascending. */
export function compareUtf8Bytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Return a new array sorted by UTF-8 byte order. */
export function byteSorted(values: readonly string[]): string[] {
  return [...values].sort(compareUtf8Bytes);
}
