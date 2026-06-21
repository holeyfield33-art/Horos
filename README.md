# Horos

A deterministic context router with provenance. Horos selects which repository
files a language model should receive for a task and emits a signed, **replayable**
receipt of the selection, the ranking, the exclusions, and any dependency it could
not resolve.

The guarantee is **auditable model input**: given the exact graph, weight policy,
task, and selector build recorded in a receipt, an auditor can re-run selection and
confirm the result — and the `receipt_hash` — are identical.

See [`SPEC-v0.1.md`](./SPEC-v0.1.md) for the full specification. It is the source of
truth; if code and spec disagree, the spec wins. Implementation choices the spec
leaves open are pinned in [`DECISIONS.md`](./DECISIONS.md).

## Status

Built against the v0.1 build order (`SPEC-v0.1.md` §8):

- [x] **PR 0 — canonical forms and frozen test vectors (§2).** Every value that
      feeds a hash has exactly one defined byte form, proven by committed vectors.
- [x] **PR 1 — graph artifact schema, loader, hard gates (§4).**
- [x] **PR 2 — selector config & weight policy hashing (§2.5, §6).**
- [x] **PR 3 — selection pipeline over fixture graphs (§6.1–6.3).**
- [x] **PR 4 — content re-verification gate (§6.4).**
- [x] **PR 5 — receipt generation and signing (§5).**
- [x] **PR 6 — verify CLI (§5.3).**
- [x] **PR 7 — TypeScript/JavaScript graph generator (§4).**

## Verifying a receipt

```sh
horos verify <receipt.json> --graph <graph.json> --task "<task text>" \
  [--config <config.json>] [--manual a.ts,b.ts] [--repo <dir>]
```

Re-runs selection from the supplied inputs and prints `PASS <receipt_hash>` or
`FAIL <field>: <detail>` (exit 0 / 1; 2 on usage error). With `--repo` it also
runs the §6.4 content re-verification gate.

## Generating a graph (producer side)

`generateGraph` (`src/generator`) walks a TS/JS project and emits a conformant
artifact, delegating module resolution to the TypeScript resolver (tsconfig
`paths`) and emitting unresolved edges as first-class members of the edge list.

## Canonical forms (PR 0)

`src/canonical/` is the single source of canonical bytes and hashes. Nothing in the
router may hash an input except through this module.

| Form | Function | Spec |
|------|----------|------|
| Canonical JSON | `cjson` / `cjsonString` | §2.1 |
| Task normalization | `taskHash` / `normalizeTaskTokens` | §2.2 |
| Repo manifest / `tree_hash` | `treeHash` / `manifestBytes` | §2.3 |
| Manual includes | `manualIncludeHash` | §2.4 |
| Selector config | `selectorConfigHash` | §2.5 |
| Weight policy | `weightPolicyHash` | §2.5 |
| Graph artifact | `graphArtifactHash` | §2.1 |
| Receipt payload | `receiptPayloadHash` | §5 |
| Primitives | `sha256`, `ed25519Sign`, `ed25519Verify` | §2 |

Frozen vectors live in [`vectors/canonical-forms.json`](./vectors/canonical-forms.json)
and are regenerated only via `scripts/generate-vectors.ts` after an intentional,
versioned algorithm change.

## Development

```sh
npm install
npm run typecheck   # strict tsc, no emit
npm test            # vitest: vector + primitive suites
npm run build       # emit dist/ (library only)
```

Requires Node >= 20.
