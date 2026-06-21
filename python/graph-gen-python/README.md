# @horos/graph-gen-python

A Python dependency-graph generator that emits the FROZEN `context-graph-v0`
artifact consumed by the Horos TypeScript router. It is the Python peer of the TS
generator — a **new producer**, not a change to the contract. A Python-generated
graph loads, selects, signs, and verifies through the unchanged TS router.

- **Static & deterministic:** parses with `ast`/`tokenize` only — never imports,
  executes repo code, consults `sys.path`, or scans site-packages. Pure stdlib, no
  pip dependencies. The same commit + same `horos.json` produces a byte-identical
  graph on any machine.
- **First-party vs external** is decided by a checked-in `horos.json`, never by
  reading a dependency manifest (PyPI distribution names differ from import names).

See `SPEC-python-generator-v0.md` and `DECISIONS-py.md` at the repo root.

## Config — `horos.json`

```json
{
  "python_source_roots": ["src", "."],
  "external_modules": ["requests", "numpy", "PIL", "bs4"]
}
```

- `python_source_roots`: repo-relative dirs where first-party code lives.
- `external_modules`: top-level **import names** (not distribution names) that are
  third-party. The stdlib is seeded automatically and need not be listed.

## Usage

```bash
python -m graph_gen_python --repo <dir> --config horos.json [--out graph.json]
    [--repository-origin <url>] [--commit-sha <sha>] [--generated-at <iso8601>]
```

The artifact is written to `--out` (or stdout). The completion report — the
distinct top-level module names classified `module_not_found`, candidates for
`external_modules` — and the `graph_artifact_hash` print to stderr. The report is
pure reporting; it does not affect the artifact or its hash.

## Tests

Stdlib `unittest`, zero pip installs:

```bash
cd python/graph-gen-python
python3 -m unittest discover -s tests
```

`tests/test_canonical.py` is the cross-language parity gate (frozen
`vectors/canonical-forms.json`). `tests/test_e2e.py` is the authoritative
acceptance proof: it drives the **real TS router** (built `dist/`) end-to-end via
`tests/parity/verify_parity.mjs` and asserts PASS, plus byte-level determinism.
The router test self-skips if `dist/` is not built (`npm install && npm run build`
at the repo root) or `node` is unavailable.
