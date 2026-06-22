# Horos

**Deterministic context router with a signed, replayable receipt.**

Horos selects which repository files a language model needs for a task, and emits
a cryptographically signed receipt that records exactly what was selected, why,
and what it could not resolve. The receipt is the product: an auditor can
re-run selection from the same inputs and confirm the `receipt_hash` is identical.

---

## The problem

Agents receive context that is unaudited and often bloated. There is no record of
what a model was actually shown — making bugs hard to reproduce, costs hard to
control, and trust hard to establish. When something goes wrong you cannot prove
whether the model had the right files at all.

## What Horos does

1. **Selects** the files a model needs for a task via a deterministic pipeline:
   entrypoint discovery → dependency-graph expansion → score ranking → budget
   enforcement.
2. **Emits a signed receipt** — a JSON object that records the selected files
   (with hashes and evidence), the exclusions with reason codes, any dependency
   it could not resolve, and a SHA-256 `receipt_hash` over all of this, signed
   with Ed25519.
3. **Replays**. Given the same graph, task, and selector version, `horos verify`
   re-runs selection and confirms the `receipt_hash` and signature match. No
   external service required.

The receipt makes "auditable model input" concrete: you can give anyone the
graph, the task, and the receipt and they can verify the selection independently.

---

## Quickstart — TypeScript/JavaScript

**Requirements:** Node >= 20, Git.

```sh
# 1. Clone and build (one-time setup)
git clone https://github.com/holeyfield33-art/horos
cd horos
npm install && npm run build
```

```sh
# 2. Generate a dependency graph from your TS/JS project
node scripts/generate.mjs --tsconfig /path/to/your-project/tsconfig.json \
    --out graph.json
# stderr: graph written to graph.json
```

```sh
# 3. Route a task — select files and sign a receipt
node scripts/route.mjs graph.json "fix the auth middleware" --out receipt.json
# stderr: public_key: <hex>
# stderr: receipt_hash: <hash>
# stderr: selected: N files
```

```sh
# 4. Verify the receipt independently
node dist/cli/horos.js verify receipt.json \
    --graph graph.json \
    --task "fix the auth middleware"
# → PASS <receipt_hash>
```

**Try it against this repo:**

```sh
node scripts/generate.mjs --tsconfig tsconfig.json --out graph.json
node scripts/route.mjs graph.json "verify receipt signature" --out receipt.json
node dist/cli/horos.js verify receipt.json \
    --graph graph.json --task "verify receipt signature"
# PASS <receipt_hash>
```

---

## Quickstart — Python

The Python generator produces the same `context-graph-v0` artifact as the TS
generator. The TS router and `horos verify` CLI consume both identically.

**Requirements:** Python >= 3.11 (stdlib only — no pip installs), plus the Horos
Node build from above.

**Step 1 — write `horos.json` in your Python project:**

```json
{
  "python_source_roots": ["src"],
  "external_modules": ["requests", "flask", "sqlalchemy"]
}
```

`python_source_roots` lists repo-relative directories where first-party code
lives. `external_modules` lists top-level *import names* (not distribution
names) of third-party packages. The standard library is seeded automatically.

See [docs/QUICKSTART-python.md](./docs/QUICKSTART-python.md) for a full
walkthrough including the completion report and the `external_modules`
iteration loop.

**Step 2 — generate a graph:**

```sh
cd /path/to/horos/python/graph-gen-python
python3 -m graph_gen_python \
    --repo /path/to/your-python-project \
    --config /path/to/your-python-project/horos.json \
    --out graph.json
```

The generator prints a **completion report** to stderr. If any imports were
`module_not_found`, it lists the distinct top-level names so you can add them to
`external_modules` and re-run:

```
Unresolved top-level modules (candidates for external_modules):
  celery
  stripe
Add genuine third-party names to horos.json -> external_modules and re-run.
graph_artifact_hash: 4a3f1...
```

**Step 3 — route and verify** (same as TS steps 3–4):

```sh
cd /path/to/horos
node scripts/route.mjs graph.json "add user authentication" --out receipt.json
node dist/cli/horos.js verify receipt.json \
    --graph graph.json --task "add user authentication"
# PASS <receipt_hash>
```

---

## What a receipt looks like

```json
{
  "version": "0.1",
  "timestamp": "2026-06-22T00:00:00.000Z",
  "task_id": "a1b2c3d4-e5f6-4789-8012-3456789abcde",
  "repository": {
    "origin": "github.com/acme/api-server",
    "commit_sha": "4b825dc642cb6eb9a00b213b2e3fc7e42d99217c",
    "tree_hash": "0000000000000000000000000000000000000000000000000000000000000001"
  },
  "task": {
    "task_hash": "2ee1622effac7736097cc37ffd28706f06207e494c9dd5fa3ef771b3804d1538",
    "task_class": "bugfix"
  },
  "selector": {
    "version": "0.1.0",
    "config_hash": "7af88c0c66f134ae812d52afdb22f01bb866f6f5434424a95f36f2f9920fbbfd",
    "weight_policy_hash": "6266e0181962579284153459221de7a8dd6f7df68fccbd73d8e2b227b6df3be5"
  },
  "graph": {
    "graph_artifact_hash": "1def366829813b5cf3bd29f167f0d53aea16f489d6f9fbcfc636b3eb3cf79d8d",
    "graph_generator": { "name": "horos-ts-generator", "version": "0.1.0" },
    "graph_supplied_externally": true
  },
  "selection": [
    {
      "path": "src/auth/session.ts",
      "content_hash": "a2",
      "token_count": 200,
      "rule": "entrypoint",
      "rule_evidence": ["exact_filename:session", "containing_directory:auth"],
      "rank": 1
    },
    {
      "path": "src/db.ts",
      "token_count": 300,
      "rule": "import_walk",
      "rule_evidence": ["edge:src/auth/session.ts->src/db.ts:STATIC_IMPORT"],
      "rank": 2
    }
  ],
  "exclusions": [
    { "path": "src/auth/jwt.test.ts", "reason_code": "HEURISTIC_IGNORE_TESTS" }
  ],
  "coverage": {
    "files_scanned": 5,
    "files_selected": 3,
    "unresolved_symbols": ["@/plugins/${name}"],
    "graph_frontier_size": 1
  },
  "prev_receipt_hash": null,
  "receipt_hash": "df830196c582e7670d830d500132240813aaaca37aa553f23f256c7183b09f32",
  "signature": {
    "algorithm": "Ed25519",
    "public_key": "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
    "value": "d81bc8c55f8d65f9284e284d93b6bfc64b8c2ae3d26c7c37cf5d291b2d2224d..."
  }
}
```

Key fields at a glance:

| Field | What it attests |
|---|---|
| `receipt_hash` | SHA-256 of the canonical payload (everything except itself and `signature`). Identical on replay. |
| `selection[].rule_evidence` | Why each file was included: which entrypoint rule fired, which graph edge was followed. |
| `exclusions[].reason_code` | Why a candidate was excluded: `HEURISTIC_IGNORE_TESTS`, `BUDGET_TRUNCATED`, etc. |
| `coverage.unresolved_symbols` | Import targets the graph could not resolve — transparency about gaps. |
| `signature.public_key` | The 32-byte Ed25519 public key that signed this receipt. Trust in the receipt is trust in this key. |

See [docs/RECEIPTS.md](./docs/RECEIPTS.md) for a field-by-field annotated walkthrough.

---

## Boundary statement

Horos attests that selection was performed correctly *relative to the supplied
dependency graph*. If the graph is incomplete — because a source root was
misconfigured, a language is unsupported, or an import was dynamic and could not
be statically resolved — the receipt records what was missing (`coverage.
unresolved_symbols`, `coverage.graph_frontier_size`) but cannot attest to what
the graph omitted. Generating a graph with more complete coverage and re-routing
produces a new, independent receipt. The receipt is always honest about what it
does not know.

---

## Status

**v0.3.2 — early, usable for TS/JS + Python.**

| Component | Status |
|---|---|
| Canonical forms + frozen vectors | Stable |
| Graph artifact schema (TS + Python) | Stable |
| Selection pipeline | Stable |
| Receipt + Ed25519 signing | Stable |
| `horos verify` CLI | Stable |
| TypeScript/JavaScript generator | Stable |
| Python generator | Stable (v0.3.1 — same-named-package layouts supported) |
| MCP server (`mcp/`) | Implemented, not yet publicly hosted |
| Other language generators | Not yet started |

Validated on this repo's own source and against real external repositories.
Not yet benchmarked or tuned for very large monorepos (>10k files).

---

## Key management

Receipts are signed with an Ed25519 key you control. See
[docs/KEY-MANAGEMENT.md](./docs/KEY-MANAGEMENT.md) for how to generate a keypair,
where to store the seed, and what the honest trust model is for v0.x.

---

## Development

```sh
npm install
npm run typecheck   # strict tsc, no emit
npm test            # vitest: all TS suites
npm run build       # emit dist/

# Python generator tests
cd python/graph-gen-python
python3 -m unittest discover -s tests
```

Requires Node >= 20.

---

## Further reading

- [`SPEC-v0.1.md`](./SPEC-v0.1.md) — the full specification; source of truth
- [`DECISIONS.md`](./DECISIONS.md) — implementation pins for canonical forms and the TS router
- [`DECISIONS-py.md`](./DECISIONS-py.md) — Python generator implementation decisions
- [`docs/QUICKSTART-python.md`](./docs/QUICKSTART-python.md) — full Python onboarding walkthrough
- [`docs/KEY-MANAGEMENT.md`](./docs/KEY-MANAGEMENT.md) — signing key setup and trust model
- [`docs/RECEIPTS.md`](./docs/RECEIPTS.md) — annotated receipt field reference
