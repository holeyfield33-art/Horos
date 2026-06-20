/**
 * Canonical JSON (`cjson`) — SPEC §2.1.
 *
 * One defined byte representation for every value that feeds a hash. Pinned to
 * RFC 8785 (JCS) semantics, with object keys sorted by Unicode code point as the
 * spec requires (RFC 8785 itself sorts by UTF-16 code unit; the two agree for all
 * Basic Multilingual Plane keys, which is everything Horos hashes, but the spec
 * wording governs — see DECISIONS.md).
 *
 * Leaf primitives reuse `JSON.stringify`, whose string escaping (minimal, no
 * forward-slash escaping, control chars via short escapes or \u00xx) and number
 * formatting (ECMAScript `Number::toString`, shortest round-tripping form) are
 * already RFC 8785 compliant. Objects and arrays are assembled by hand so key
 * ordering and whitespace are under our control.
 */

export type CanonicalPrimitive = string | number | boolean | null;

export type CanonicalValue =
  | CanonicalPrimitive
  | readonly CanonicalValue[]
  | CanonicalObject;

export interface CanonicalObject {
  readonly [key: string]: CanonicalValue | undefined;
}

export class CanonicalizationError extends Error {
  public override readonly name = "CanonicalizationError";
}

/**
 * Compare two strings by Unicode code point, ascending. String iteration yields
 * whole code points (surrogate pairs combined), so this differs from the default
 * `<` operator only for astral-plane characters.
 */
export function compareCodePoints(a: string, b: string): number {
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const an = ai.next();
    const bn = bi.next();
    if (an.done === true && bn.done === true) return 0;
    if (an.done === true) return -1;
    if (bn.done === true) return 1;
    const acp = an.value.codePointAt(0) as number;
    const bcp = bn.value.codePointAt(0) as number;
    if (acp !== bcp) return acp < bcp ? -1 : 1;
  }
}

function encodePrimitive(value: CanonicalPrimitive): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(
          `non-finite number is not representable in cjson: ${String(value)}`,
        );
      }
      // ECMAScript Number::toString === RFC 8785 number form for finite values.
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    default: {
      const exhaustive: never = value;
      throw new CanonicalizationError(`unreachable primitive: ${String(exhaustive)}`);
    }
  }
}

function canonicalize(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") {
    return encodePrimitive(value);
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (item === undefined) {
        throw new CanonicalizationError("undefined is not a valid array element");
      }
      parts.push(canonicalize(item));
    }
    return `[${parts.join(",")}]`;
  }

  const obj = value as CanonicalObject;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort(compareCodePoints);

  const parts = keys.map((key) => {
    const child = obj[key] as CanonicalValue;
    return `${encodePrimitive(key)}:${canonicalize(child)}`;
  });
  return `{${parts.join(",")}}`;
}

/** Canonical JSON as a string. */
export function cjsonString(value: CanonicalValue): string {
  if (value === undefined) {
    throw new CanonicalizationError("undefined is not a valid cjson root value");
  }
  return canonicalize(value);
}

/** Canonical JSON as UTF-8 bytes — the form that feeds every hash. */
export function cjson(value: CanonicalValue): Uint8Array {
  return new TextEncoder().encode(cjsonString(value));
}
