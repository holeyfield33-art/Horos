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

## Selection pipeline (§6.1–6.3) — entrypoint_rules v1

SPEC §6.1 lists the entrypoint rules and their scores but not the exact matching
semantics, and §6.2 does not define score propagation through BFS. These are
pinned here and versioned by `entrypoint_rules.version` (part of
`selector_config_hash`), so any change is a visible, versioned change. **Flagged
for review** — these are reasonable v1 heuristics, not spec-mandated exact rules.

- **Matching normalization:** filename stems, directory names, and export names
  are NFKC + lowercased, then compared for *exact equality* against the
  normalized task tokens (§2.2). Stems drop every extension (`a.test.ts` → `a`).
- **Rule stacking:** a node's entrypoint score is the sum of every rule it
  matches (directory match counts once; exported-symbol match counts once).
- **Test-pair (+30):** a test file whose subject stem matches a token boosts the
  *subject* file (same directory, same stem, non-test), not the test file itself.
  Test files are never selected (see heuristic filter) so scoring them directly
  would be pointless.
- **Config-route (+20):** a node that is the target of a `FRAMEWORK_ROUTE` or
  `CONFIG_REFERENCE` edge and whose stem matches a token.
- **BFS score propagation:** seeded by entrypoint scores at depth 0; for a
  resolved edge `u -> v`, `score(v) = max(score(v), score(u) * edge_weight(type))`,
  relaxed for `max_depth_hops` rounds (longest-product path, deterministic
  regardless of edge order). Scores are rounded to 1e-6 to stabilize float
  products for tie-breaking. Score is internal to ranking and is **not** written
  to the receipt (the receipt records `rank`, not score, per §5).
- **Heuristic filters (decision 4):** candidates matching the test pattern are
  excluded `HEURISTIC_IGNORE_TESTS`; build/output paths `HEURISTIC_IGNORE_BUILD`.
  Recorded as exclusions, never silently dropped.
- **Depth-exceeded:** nodes reachable one hop beyond `max_depth_hops` are
  recorded as `DEPTH_EXCEEDED` exclusions.
- **Budget (§6.3):** ranked files are admitted in order while `files < max_files`
  and `running_tokens + token_count <= max_tokens`; the first file that violates
  either budget — and every file after it — is excluded `BUDGET_TRUNCATED`.
- **Coverage:** `graph_frontier_size` counts edges leaving the visited region not
  followed into the selection (unresolved edges from visited sources + resolved
  edges from visited sources to unselected targets). `unresolved_symbols` records
  `raw_specifier` (falling back to `resolution_error`) for unresolved edges whose
  source was visited. `entrypoints` lists all discovered entrypoints (including
  any later heuristically excluded). `rank` is 1-based.
