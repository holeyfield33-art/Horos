# Horos — Context Router with Provenance — Specification v0.1

> A deterministic context selection engine that emits signed, replayable receipts of
> which repository files were provided to a language model and why.
> Status: v0.1. Revised after adversarial review of v0. Build-ready.

---

## CHANGE LOG FROM v0

- Added §2: a single formalized set of **canonical forms** for every hashed input.
  Resolves five reproducibility findings (task normalization, graph serialization,
  manifest definition, manual-include hashing, entrypoint determinism) that shared one
  root cause: a hash was named without defining the bytes that produce it.
- Added §6.4: **runtime content re-verification** — the router verifies each selected
  file's current content against the graph's recorded hash and aborts on mismatch.
- Removed `confidence_class` from the receipt. It contradicted the no-confidence-scores
  decision and asserted an unverifiable property.
- Defined `tree_hash` / repo manifest precisely.
- Consolidated `receipt_id` into `receipt_hash` (one canonical hash).
- Shipped `resolution_error` as a versioned enum with compatibility rules.
- Removed process and slogan language from the specification text.

---

## 1. PURPOSE AND BOUNDARY

Horos selects which repository files a language model should receive for a given task, and
emits a signed receipt recording the selection, the ranking, the exclusions, and any
dependencies it could not resolve. The receipt is replayable: an auditor can re-run
selection from the recorded inputs and confirm the result is identical.

The product guarantee is **auditable model input**. Reduced token usage is a side effect.

### Boundary

Horos attests **selection correctness relative to a supplied dependency graph**. It does
not attest that the graph itself is correct. The signature certifies: *given this exact
graph, this weight policy, this task, and this selector build, the selection and ranking
were produced deterministically and exactly as recorded.* If the supplied graph is wrong,
the receipt's provenance fields identify the generator responsible, and the audit proceeds
upstream. Horos asserts nothing it cannot verify.

---

## 2. CANONICAL FORMS (foundational — implement first)

Every value that feeds a hash must have a single defined byte representation. Without this,
two correct implementations produce different hashes for identical logical input and replay
fails. This section is a hard prerequisite for all selection logic.

A single canonicalization function produces bytes for all of the following. Each must ship
with committed frozen test vectors.

### 2.1 Canonical JSON (`cjson`)
Applies to: graph artifact, selector config, weight policy, receipt payload.
- Object keys sorted by Unicode code point, ascending.
- No insignificant whitespace.
- UTF-8 encoding.
- Numbers: integers only where possible; a defined fixed representation for any
  non-integer. No platform-dependent float formatting.
- Absent fields are absent, not `null`, unless the schema defines the field as nullable
  (e.g. edge `target`).
- Candidate implementation: RFC 8785 JCS, or the existing Helios canonical serializer
  (validated across two language implementations). Choose one and pin it.

### 2.2 Task normalization
Applies to: `task_hash`.
- Unicode NFKC normalization.
- Lowercase via Unicode default case folding.
- Tokenize on a defined rule (Unicode word boundaries; exact rule committed).
- Stopword removal against an explicit, versioned stopword list committed to the repo.
- The normalized token sequence is serialized as `cjson` (an array of strings) before
  hashing.
- The stopword list and tokenization rule version are part of `selector_config_hash`.

### 2.3 Repo manifest
Applies to: `tree_hash`.
- `git ls-tree -r --name-only <commit>`, sorted by byte order, one path per line, LF
  separated, UTF-8, hashed with SHA-256.
- Tracked files only. Untracked and gitignored files are excluded by definition.
- The same manifest definition is used by the graph generator, so generator and router
  agree on what "the repository at this commit" means.

### 2.4 Manual includes
Applies to: `manual_include_hash`.
- The manual-include list is sorted by byte order, serialized as `cjson`, and hashed.
- `manual_include_hash` is part of the replay inputs (§5.3). A change to manual includes
  changes the receipt hash.

### 2.5 Selector config and weight policy
Applies to: `selector_config_hash`, `weight_policy_hash`.
- Both serialized as `cjson` and hashed independently.
- `weight_policy_hash` covers only the edge-weight table, so a ranking dispute resolves to
  exactly that table.

---

## 3. DESIGN DECISIONS

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Primary failure mode is resolution failure, not the semantic gap. | An undetected missing dependency is more severe than a reported unresolved one, because it produces a clean receipt over incomplete context. |
| 2 | Provenance anchors: `commit_sha`, `tree_hash`, `selector_version`, `selector_config_hash`, `weight_policy_hash`, `graph_artifact_hash`, `task_hash`, `manual_include_hash`. Content hash alone is insufficient. | Identical file hashes can yield different selections when any other input differs. |
| 3 | No confidence scores. Unresolved dependencies are reported structurally (frontier, unresolved-symbol list) plus a recorded manual-include path. | A deterministic selector cannot estimate relevance for something it never discovered; a numeric confidence implies rigor it does not have. |
| 4 | Exclusions are recorded explicitly with reason codes. | Distinguishes a deliberate skip from a silent drop. |
| 5 | Two-tier chain: thin link object plus full receipt. | An auditor can walk the chain without parsing every full receipt. |
| 6 | `rule_evidence` is a structured array. | A file may be selected for more than one reason; all are recorded. |
| 7 | The resolver runs as a pre-step that emits a static artifact. It never executes during routing. | A locally installed resolver or language server is not reproducible across machines. |
| 8 | v1 covers TypeScript/JavaScript only. The dependency-graph artifact is a mandatory input; its absence is a hard error. | Keeps the router out of language-resolution work while preventing selection over an unknown graph. |
| 9 | Unresolved edges are first-class elements of the graph's edge list and enter graph traversal. They are never dropped or moved to a separate log. | This is what makes unreported misses impossible at the data layer. |
| 10 | A mismatch between the graph's recorded `commit_sha` and the repository being routed aborts execution. | Prevents routing against a graph generated for a different commit. |
| 11 | The selector owns edge weights. The graph carries edge `type` only. Generator-observed semantics are expressed through the type vocabulary. | Structure and ranking remain separately auditable and changeable. Re-weighting is a config edit, not a graph regeneration. |

---

## 4. DEPENDENCY GRAPH ARTIFACT

The interface between the repository's build/CI (which generates the artifact) and the
router (which consumes and hashes it). The router never generates it.

```json
{
  "$schema": "context-graph-v0",
  "metadata": {
    "graph_id": "cjson_sha256(graph)",
    "generator": {
      "name": "@horos/graph-gen-typescript",
      "version": "1.2.4",
      "command_executed": "graph-gen --include-dynamic --project tsconfig.json",
      "execution_mode": "ci"
    },
    "config_hash": "sha256(generator_config)",
    "provenance": {
      "repository_origin": "github.com/org/repo",
      "commit_sha": "4b825dc642cb6eb9a00b213b2e3fc7e42d99217c",
      "tree_hash": "sha256(manifest)",
      "generated_at": "2026-06-20T22:30:00Z"
    },
    "resolver_stack": [
      { "name": "typescript", "version": "5.8.2" },
      { "name": "tsconfig-paths", "version": "5.2.1" }
    ],
    "coverage": {
      "files_total": 412,
      "files_indexed": 410,
      "edges_total": 1832,
      "unresolved_edges": 17
    },
    "completeness": "partial"
  },
  "nodes": {
    "src/auth/session.ts": {
      "file_path": "src/auth/session.ts",
      "language": "ts",
      "content_hash": "sha256(content)",
      "token_count": 1420,
      "exports": ["createSession", "validateSession"]
    }
  },
  "edges": [
    {
      "source": "src/api.ts",
      "target": "src/auth/session.ts",
      "type": "STATIC_IMPORT",
      "resolved": true,
      "line": 12
    },
    {
      "source": "src/router.ts",
      "target": null,
      "type": "DYNAMIC_IMPORT",
      "resolved": false,
      "raw_specifier": "@/utils/${strategy}",
      "resolution_error": "dynamic_template_literal",
      "line": 30
    }
  ]
}
```

- **Nodes:** keyed by file path. `content_hash` and `token_count` are mandatory; `exports`
  optional. Field name `content_hash` is used consistently here and in the receipt.
- **Edge types:** `STATIC_IMPORT`, `RE_EXPORT`, `DYNAMIC_IMPORT`, `FRAMEWORK_ROUTE`,
  `TEST_REFERENCE`, `CONFIG_REFERENCE`. The type expresses generator-observed semantics
  (a lazy route is `FRAMEWORK_ROUTE`, not a weighted `DYNAMIC_IMPORT`).
- **Edges carry no weights.**
- **`resolution_error`** is a versioned enum shipped in the schema:
  `alias_not_found`, `dynamic_template_literal`, `module_not_found`, `unsupported_syntax`,
  `external_boundary`. Compatibility rule: a router rejects an artifact whose
  `$schema` minor version exceeds its own *only* if it encounters an enum value it does not
  recognize; recognized values within a known schema version always validate. Unknown
  values are a hard validation failure, never a silent skip.
- **Coverage is declarative:** stated by the generator, consumed by the router, never
  inferred.

### Unresolved-edge handling
1. Traversal halts at the null target.
2. `raw_specifier` and `resolution_error` are written to `coverage.unresolved_symbols`.
3. The edge is counted in `graph_frontier_size`.

### Hard gates
- No artifact supplied: return `error: graph artifact required`; emit no receipt.
- `metadata.provenance.commit_sha` does not match the repository HEAD being routed: abort.

---

## 5. RECEIPT

```json
{
  "version": "0.1",
  "timestamp": "RFC3339",
  "task_id": "uuid-v4",

  "repository": {
    "origin": "github.com/org/repo",
    "commit_sha": "hex",
    "tree_hash": "sha256(manifest)"
  },

  "task": {
    "task_hash": "sha256(cjson(normalized_tokens))",
    "task_class": "audit|bugfix|feature|test|other"
  },

  "selector": {
    "version": "0.1.0",
    "config_hash": "sha256(cjson(selector_config))",
    "weight_policy_hash": "sha256(cjson(edge_weights))"
  },

  "graph": {
    "graph_artifact_hash": "sha256(cjson(graph))",
    "graph_generator": { "name": "typescript", "version": "5.8.2" },
    "graph_supplied_externally": true
  },

  "manual_include": ["src/policy/new_engine.ts"],
  "manual_include_hash": "sha256(cjson(sorted_manual_includes))",

  "selection": [
    {
      "path": "src/auth/jwt.ts",
      "content_hash": "hex",
      "token_count": 1420,
      "rule": "import_walk",
      "rule_evidence": ["task_match:auth", "edge:src/index.ts->src/auth/jwt.ts"],
      "rank": 12
    }
  ],

  "exclusions": [
    { "path": "src/auth/jwt.test.ts", "reason_code": "HEURISTIC_IGNORE_TESTS" }
  ],

  "coverage": {
    "files_scanned": 412,
    "files_selected": 17,
    "entrypoints": ["src/index.ts"],
    "unresolved_symbols": ["@/utils/${strategy}"],
    "excluded_candidates": ["src/policy/new_engine.ts"],
    "graph_frontier_size": 18
  },

  "prev_receipt_hash": "hex | null",
  "receipt_hash": "sha256(cjson(payload_without_receipt_hash_and_signature))",
  "signature": {
    "algorithm": "Ed25519",
    "public_key": "hex",
    "value": "hex"
  }
}
```

`receipt_hash` is the single canonical identifier; there is no separate `receipt_id`.
`receipt_hash` is computed over the canonical payload excluding `receipt_hash` and
`signature`, then signed.

### 5.1 Thin chain-link object
```json
{ "chain_id": "uuid", "seq": 42, "prev_receipt_hash": "hex", "receipt_hash": "hex", "signature": "hex" }
```

### 5.2 `reason_code` enum (exclusions)
`HEURISTIC_IGNORE_TESTS`, `HEURISTIC_IGNORE_BUILD`, `BUDGET_TRUNCATED`,
`DEPTH_EXCEEDED`, `EXPLICIT_EXCLUDE`. Versioned and closed like `resolution_error`.

### 5.3 Replay requirement
Given `task_hash`, `commit_sha`, `tree_hash`, `selector.version`, `selector.config_hash`,
`weight_policy_hash`, `graph_artifact_hash`, and `manual_include_hash`, re-running the
selector produces an identical file set, identical ranking, identical exclusions, and an
identical `receipt_hash`.

---

## 6. SELECTION PIPELINE

```
Task arrives
  -> Normalize task        (§2.2, deterministic)
  -> Entrypoint discovery  (§6.1, deterministic, versioned rules)
  -> Graph expansion       (bounded BFS over the artifact; max_depth_hops)
  -> Heuristic ranking     (edge-type weights from selector config)
  -> Budget enforcement    (deterministic truncation: max_files, max_tokens)
  -> Content re-verification (§6.4)
  -> Coverage analysis     (unresolved edges, excluded-but-nearby candidates)
  -> Receipt generation + signature
```

### 6.1 Entrypoint discovery (deterministic, in selector config)
Each rule produces matches with a fixed score; ties break by path byte order.
- Exact filename match against a normalized task token: +100
- Containing-directory match: +50
- Exported-symbol name match (requires graph `exports`): +40
- Test-pair match (a test file whose subject matches): +30
- Config-route reference: +20

The full rule set, its scores, and its version are part of `selector_config_hash`.

### 6.2 Ranking
Stable sort by score descending, then path byte order ascending.

### 6.3 Budget enforcement
Deterministic truncation to `max_files` and `max_tokens`. Truncated files are recorded as
exclusions with `reason_code: BUDGET_TRUNCATED`.

### 6.4 Content re-verification (added in v0.1)
Before a file is included, the router computes the SHA-256 of its current content and
compares it to the node's `content_hash` in the graph. On mismatch, execution aborts with
`error: content drift <path>`. This prevents selecting a file whose content no longer
matches the graph the receipt attests to.

### Selector config (ranking policy)
```json
{
  "ranking_strategy": {
    "edge_weights": {
      "STATIC_IMPORT": 1.0,
      "RE_EXPORT": 0.8,
      "DYNAMIC_IMPORT": 0.5,
      "FRAMEWORK_ROUTE": 1.2,
      "TEST_REFERENCE": 0.1,
      "CONFIG_REFERENCE": 0.4
    },
    "max_depth_hops": 3,
    "max_files": 40,
    "max_tokens": 60000
  }
}
```

---

## 7. v1 NON-GOALS

- No language beyond TypeScript/JavaScript.
- The router does not generate the dependency graph.
- No model in the selection loop.
- No confidence scoring.
- No degraded mode when the graph is missing; absence is a hard error.

---

## 8. BUILD ORDER

1. Canonical forms and frozen test vectors (§2). Prerequisite for everything.
2. Graph artifact schema, loader, and the two hard gates (§4).
3. Selector config and weight policy hashing (§6, §2.5).
4. Selection pipeline against fixture graphs, including content re-verification (§6).
5. Receipt generation and signing (§5).
6. Verify CLI: re-runs selection from recorded inputs and asserts `receipt_hash`
   equality (§5.3).
7. TypeScript/JavaScript graph generator (§4), as a separate package.

No receipt may be emitted that the verify CLI cannot replay.
