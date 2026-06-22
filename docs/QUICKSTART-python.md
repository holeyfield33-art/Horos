# Python quickstart

A complete walkthrough for routing a Python repo from zero — generating a graph,
reading the completion report, and verifying a receipt.

**Requirements:**
- Python >= 3.11 (stdlib only — no pip installs)
- The Horos Node build: `npm install && npm run build` at the repo root
- Node >= 20

---

## 1. Write `horos.json`

Create `horos.json` in your Python project root (or anywhere; pass it via
`--config`):

```json
{
  "python_source_roots": ["src"],
  "external_modules": ["requests", "flask", "sqlalchemy", "celery"]
}
```

**`python_source_roots`** — repo-relative directories where first-party Python
source lives. The generator strips the root prefix from paths to form module
names, and discovers only files under these roots.

Common layouts:

| Layout | `python_source_roots` |
|---|---|
| `src/mypackage/` (src-layout) | `["src"]` |
| `mypackage/` at repo root | `["mypackage"]` or `["."]` |
| Multiple packages at root | `["."]` |
| `lib/foo/` and `lib/bar/` | `["lib"]` |

**`external_modules`** — top-level *import names* of third-party packages.
Use the name you write in `import X` statements, not the PyPI distribution name
(e.g. `PIL` not `Pillow`, `bs4` not `beautifulsoup4`, `cv2` not `opencv-python`).

The standard library is seeded automatically and does not need to be listed.
You do not need to list everything upfront — the completion report tells you what
to add.

### Same-named-package layouts (v0.3.1+)

If your source root directory has the same name as your package (e.g.
`mypackage/` with `source_roots: ["mypackage"]`), absolute self-imports like
`import mypackage.utils` resolve correctly since v0.3.1. Both the root-stripped
form (`utils`) and the package-qualified form (`mypackage.utils`) are indexed.

This covers Django (`source_roots: ["django"]`), Requests
(`source_roots: ["requests"]`), and most library layouts where the package lives
in a directory of its own name.

---

## 2. Generate the graph

From the `python/graph-gen-python/` directory inside your Horos clone:

```sh
python3 -m graph_gen_python \
    --repo /path/to/your-project \
    --config /path/to/your-project/horos.json \
    --out graph.json
```

All options:

```
--repo          repo root (where files live); required
--config        path to horos.json; required
--out           output file; default stdout
--repository-origin  URL recorded in the artifact (e.g. github.com/you/repo)
--commit-sha    commit SHA recorded in the artifact; default: git HEAD
--generated-at  ISO-8601 timestamp; default: HEAD committer date
```

The generator:
- Walks `python_source_roots` for `*.py` files (via `git ls-files` when possible,
  filesystem walk otherwise)
- Parses every file with `ast` — never imports, executes, or probes `sys.path`
- Emits unresolved edges as first-class members of the graph (never silently drops
  them)

The same `--commit-sha` + same `horos.json` always produces a byte-identical
`graph.json` on any machine.

---

## 3. Read the completion report

The generator prints a **completion report** to stderr. Example:

```
Unresolved top-level modules (candidates for external_modules):
  celery
  stripe
  boto3
Add genuine third-party names to horos.json -> external_modules and re-run.
graph_artifact_hash: 4a3f1c8...
```

The report lists distinct top-level module names that appeared in `import`
statements but were not in the standard library, not in `external_modules`, and
not resolvable as first-party code. These are classified `module_not_found` in
the graph.

**The iteration loop:**

1. Run the generator, read the report
2. Identify which names are genuine third-party packages you use
3. Add them to `external_modules` in `horos.json` and re-run
4. Repeat until the report is empty or only lists modules you intentionally
   exclude (e.g. optional imports, test-only dependencies)

When the report is empty, the graph is complete: every import is either resolved
to a first-party file, classified as `external_boundary` (stdlib or known
third-party), or flagged as dynamic. This is what makes the receipt attest a
complete selection.

A non-empty report is not an error — the graph is still valid and the router
will produce a verified receipt. The receipt's `coverage.unresolved_symbols`
records what was missing, so the gap is auditable. Fix the graph by iterating on
`external_modules`, not by ignoring the report.

---

## 4. Route a task

From the Horos repo root:

```sh
node scripts/route.mjs graph.json "add user authentication" --out receipt.json
```

Output to stderr:

```
public_key: 3ccd241c...
receipt_hash: 9a3f1c...
selected: 12 files
receipt written to receipt.json
```

To use a fixed signing key (recommended for reproducible receipts):

```sh
# Generate a seed once and store it somewhere safe
node -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
# → a3f9d2...  (save this as HOROS_SIGNING_KEY)

node scripts/route.mjs graph.json "add user authentication" \
    --key "$HOROS_SIGNING_KEY" --out receipt.json
```

See [KEY-MANAGEMENT.md](./KEY-MANAGEMENT.md) for key setup and storage.

---

## 5. Verify the receipt

```sh
node dist/cli/horos.js verify receipt.json \
    --graph graph.json \
    --task "add user authentication"
# → PASS 9a3f1c...
```

`horos verify` re-runs selection from the graph + task and asserts:
- The recomputed `receipt_hash` matches the stored one
- The Ed25519 signature is valid
- All provenance fields (graph hash, selector version, config hash) match

Exit 0 = PASS, exit 1 = FAIL with the diverging field, exit 2 = usage error.

---

## Worked example

Using the fixture project inside the Horos repo:

```sh
# Project layout:
#   src/pkg/__init__.py
#   src/pkg/main.py      (imports: os, requests, pkg.helpers, relative imports)
#   src/pkg/helpers.py
#   src/pkg/sub/leaf.py
#   src/pkg/relutil.py
#
# horos.json: {"python_source_roots": ["src"], "external_modules": ["requests"]}

cd python/graph-gen-python

python3 -m graph_gen_python \
    --repo tests/fixtures/py-project \
    --config tests/fixtures/py-project/horos.json \
    --repository-origin github.com/acme/example \
    --commit-sha 4b825dc642cb6eb9a00b213b2e3fc7e42d99217c \
    --generated-at 2026-06-22T00:00:00+00:00 \
    --out /tmp/py-graph.json
```

Completion report:

```
Unresolved top-level modules (candidates for external_modules):
  totally_missing_pkg
Add genuine third-party names to horos.json -> external_modules and re-run.
graph_artifact_hash: 603eb310...
```

`totally_missing_pkg` is an import that's not stdlib, not in `external_modules`,
and not a file in the project. Add it to `external_modules` if it's a real
dependency; leave it if it's intentional (the graph records it as
`module_not_found` either way).

```sh
cd /path/to/horos

node scripts/route.mjs /tmp/py-graph.json "helper relutil leaf" \
    --out /tmp/py-receipt.json
# public_key: <hex>
# receipt_hash: <hash>
# selected: 3 files

node dist/cli/horos.js verify /tmp/py-receipt.json \
    --graph /tmp/py-graph.json --task "helper relutil leaf"
# PASS <receipt_hash>
```

The selected files are `src/pkg/helpers.py`, `src/pkg/relutil.py`, and
`src/pkg/sub/leaf.py` — the three files whose names match task tokens and whose
imports are walked from them.
