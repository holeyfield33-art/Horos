# Pinned decisions — Python graph generator (v0.3)

Companion to `DECISIONS.md` for the new Python producer under
`python/graph-gen-python/`. It emits the FROZEN `context-graph-v0` artifact; it
changes nothing in the router, receipt, canonical layer, verify CLI, or the TS
generator. See `SPEC-python-generator-v0.md`.

## Canonical JSON (cjson) parity — SPEC §1/§6/§7

- **Implementation:** stdlib `json.dumps(obj, ensure_ascii=False,
  separators=(",", ":"), sort_keys=True).encode("utf-8")`. This reproduces every
  case in `vectors/canonical-forms.json#cjson` byte-for-byte (Python sorts string
  keys by Unicode code point, which matches the spec for every key Horos hashes).
- **Not hand-rolled.** A hand-written escaper/number-formatter was rejected: it is
  unnecessary and drops legitimately-`null` object fields. Every `null` value is
  preserved; no key name is special-cased.
- **Non-finite numbers** are rejected (`allow_nan=False`). Artifacts carry no
  floats, so this only guards the vector test.
- The frozen TS vectors in `vectors/canonical-forms.json` ARE the cross-language
  parity vector — the Python `cjson_bytes` reproduces their `canonical` and
  `sha256`. No fresh TS hash needs to be captured.

## token_count — SPEC §6

- Method: `tokenize.generate_tokens`, counting all tokens **excluding** this
  frozen set: `ENCODING`, `NL`, `NEWLINE`, `INDENT`, `DEDENT`, `COMMENT`,
  `ENDMARKER`. NOT a model tokenizer.
- Changing this set is a breaking change to every `token_count`. Frozen vector:
  `tests/fixtures/files/without_all.py` → `34`.

## exports — SPEC §5

- Static `__all__` (a `List`/`Tuple` of string literals) → exactly those names.
- Otherwise: top-level `def`/`async def`/`class` names not starting with `_`.
- Module-level variables/constants are exported only via `__all__`. Sorted, deduped.

## Resolution — SPEC §3/§4

- **`from M import name`** resolves each `name` as a submodule `M.name` first
  (handles bare `from . import x` and PEP 420 namespace subpackages, which have no
  `__init__.py` to carry a symbol). Names that are not submodules fold into a
  single edge to module `M`, whose `exports` the selector uses to find the symbol
  (the module-level, not symbol-level, tradeoff of SPEC §5).
- **Resolved edge targets are node-map keys** (repo-relative POSIX) by
  construction, so a target is always a member of `nodes` (the TS selector
  silently skips targets that are not node keys).
- **RE_EXPORT:** v0 does NOT emit a separate `RE_EXPORT` type. `from .sub import *`
  in an `__init__.py` is emitted as `STATIC_IMPORT` (star not expanded; the
  selector uses the target module's `exports`). RE_EXPORT remains reserved.
- Unresolved imports are always first-class edges, never dropped: stdlib or
  configured-external top segment → `external_boundary`; relative traversal that
  exits the repo root → `external_boundary`; otherwise → `module_not_found`.
  Dynamic imports (string-literal or non-literal) → `DYNAMIC_IMPORT` /
  `dynamic_template_literal`.

## Stdlib seed / resolver_stack — SPEC §4/§7

- Stdlib set = `sys.stdlib_module_names`, read as a constant (never by importing).
- Pinned to the running interpreter's version, recorded as a `resolver_stack`
  entry `{name: "python-stdlib", version: "<major.minor>"}` (3.11 in this
  environment). The resolver itself is `{name: "horos-py-resolver", version}`.

## Determinism — SPEC §10

- `generated_at` is a deterministic input. The CLI defaults it to the HEAD
  committer date (`git show -s --format=%cI`), NOT the wall clock; override with
  `--generated-at`. The same commit + same `horos.json` yields a byte-identical
  artifact and identical `graph_artifact_hash`.

## Same-named-package resolution — v0.3.1 fix (Option A)

**Bug:** When a source-root directory has the same name as the top-level package
that the repo's own code imports by (e.g. `python_source_roots: ["django"]` and
code doing `import django.urls`), the root-stripped index entry (`urls`) did not
match the import name (`django.urls`). On Django: ~3,019 of ~4,500 edges wrongly
`module_not_found`.

**Fix chosen:** Option A — index both forms. In `ModuleIndex.__init__`, for every
file that strips and resolves to a dotted name, also register the package-qualified
form `{root_final_segment}.{dotted}` under the same root's sub-index via
`setdefault` (first-wins preserved). This applies to every root ≠ `.`; the
final segment of the root path is used (`src/lib` → prepend `lib`).

**Why Option A over B:** keeps `resolve_absolute` simple; the index remains the
single source of truth for all lookups; no per-call branching.

**Edge cases verified (test_resolver.py):**
- Same-named root (`mypkg/` + `source_roots=["mypkg"]`): absolute self-imports
  resolve. No `module_not_found` for intra-package edges.
- Differing names (`src/pkg` + `source_roots=["src"]`): `pkg.helpers` still
  resolves via root-stripped form; `src.pkg.helpers` (the new qualified form)
  resolves to the same key — both harmless and consistent.
- Relative imports: unaffected — `absolutize_relative` already computes an
  absolute dotted name before lookup; the fix makes that lookup hit in more cases.
- No change to any existing fixture's resolved/unresolved classification.

## File discovery

- `git ls-files` filtered to `*.py` under the configured source roots is
  authoritative when present (gitignored/untracked junk excluded). Falls back to a
  filesystem walk when the target is not a git repo or has no tracked `.py` (an
  uncommitted working copy).
