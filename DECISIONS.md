# Pinned canonical-form decisions (PR 0)

SPEC §2 names several canonical forms but leaves a few choices to the
implementation ("choose one and pin it", "exact rule committed"). This file
records every such pin. Changing any of these is a breaking change to every hash
and must bump the relevant version identifier.

## cjson (§2.1)

- **Implementation pinned:** RFC 8785 (JCS) semantics. The "Helios canonical
  serializer" alternative offered by the spec is not available in this repo, so
  RFC 8785 — a published standard — is chosen.
- **Key ordering:** by Unicode **code point**, ascending, exactly as §2.1 states.
  RFC 8785 itself sorts by UTF-16 code unit. The two orderings agree for all
  Basic Multilingual Plane keys (every key Horos hashes), but where they could
  differ the spec wording governs and we sort by code point.
- **Numbers:** ECMAScript `Number::toString` (shortest round-tripping form),
  obtained via `JSON.stringify`. Non-finite numbers (`NaN`, `±Infinity`) are
  rejected — they have no canonical form.
- **Strings:** RFC 8785 / JSON minimal escaping (via `JSON.stringify`): only
  `"`, `\`, and U+0000–U+001F are escaped; forward slash is not; non-ASCII is
  emitted as UTF-8, not `\u`-escaped.
- **Absent vs null:** `undefined` object values and array elements are omitted /
  rejected respectively; `null` is emitted only where the schema is nullable.

## Task normalization (§2.2)

- **Case folding pinned to `String.prototype.toLowerCase` (ECMAScript).** The
  spec says "Unicode default case folding". Full Unicode default case folding
  (CaseFolding.txt, e.g. `ß → ss`, final-sigma handling) differs from ECMAScript
  lowercasing for a small set of characters and has no built-in in Node. v0.1
  pins the deterministic ECMAScript operation and records it here; the policy id
  `case_folding: "ecmascript-toLowerCase"` is part of `selector_config_hash`, so
  moving to full case folding later is a visible, versioned change. **Flagged for
  review** — if true CaseFolding.txt semantics are required, this is the one place
  code and spec intent diverge.
- **Tokenization rule** (`unicode-letters-numbers-v1`): maximal runs matching
  `/[\p{L}\p{N}]+/gu` over the case-folded string. Token order is preserved and
  duplicates are kept.
- **Stopword list:** `src/canonical/stopwords-v1.json`, version `v1`. The list
  and tokenization rule version are part of `selector_config_hash`.

## Repo manifest / tree_hash (§2.3)

- **Separator semantics, no trailing newline.** "LF separated" is implemented as
  `paths.join("\n")` — paths joined by LF with no terminating newline. (Raw
  `git ls-tree` output terminates every line including the last; the canonical
  form drops that trailing byte so generator and router agree exactly.)
- Sort is by **UTF-8 byte order** (`Buffer.compare`). Tracked files only, which
  is what `git ls-tree -r --name-only` already yields.

## Manual includes (§2.4)

- Sorted by **UTF-8 byte order**, then serialized as cjson (array of strings),
  then SHA-256.

## Ed25519 (§2 primitives, §5)

- Keys and signatures are exchanged as **hex**. Signatures are the raw 64-byte
  form; public keys the raw 32-byte form. Signing uses Node's deterministic
  Ed25519, so a fixed seed produces a fixed public key and a fixed signature over
  a fixed message — relied on by the frozen signing vector.
