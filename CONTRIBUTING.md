# Contributing to Horos

Horos is a deterministic context router. The core guarantee — that any receipt produced can be replayed byte-for-byte by `horos verify` — is non-negotiable. Every contribution must preserve it.

---

## Building and testing

**TypeScript/JavaScript:**

```sh
npm ci
npm run typecheck   # strict TS, no errors allowed
npm test            # vitest suite
npm run build       # emit dist/
```

**Python graph generator:**

```sh
cd python/graph-gen-python
python3 -m unittest discover -s tests
```

The end-to-end parity test (`tests/test_e2e.py`) shells out to the built TS router. It self-skips if `dist/` does not exist, but **a skip is not a pass** — run `npm ci && npm run build` at the repo root before running Python tests if you are touching anything near the receipt or graph contract.

---

## Non-negotiables

These are the engineering invariants the project enforces. PRs that violate them will not be merged regardless of other quality.

**Strict TypeScript.** No `as any`. No suppressed type errors. Use explicit, narrow types. If a type is genuinely unknown, narrow it before use.

**Explicit error handling.** Do not swallow errors or use catch-all `catch (e) {}` without re-throwing or returning a typed error result.

**All hashes go through the canonical serializer.** The canonical JSON serializer lives in `src/canonical/cjson.ts`. Never call `JSON.stringify` directly and feed the result into a hash — the output is not deterministic across implementations. Use `cjson.ts` for anything that ends up in a hash field.

**No receipt may be emitted that `horos verify` cannot replay.** This is the project's core guarantee (SPEC §10). Tests must prove replay, not merely that a function runs without throwing. A test that generates a receipt but does not verify it does not count as a replay test.

**Spec ambiguities are pinned, not guessed.** If you encounter an underspecified case, record your decision in `DECISIONS.md` (TS router), `DECISIONS-py.md` (Python generator), or `DECISIONS-mcp.md` (MCP server) with a rationale. Do not silently choose an interpretation.

---

## Commit and PR conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add thing
fix(scope): correct thing
test(scope): cover thing
chore(scope): maintain thing
docs(scope): document thing
```

One PR per logical change. Keep PRs small enough to review in a single pass. Do not bundle unrelated fixes.

---

## Source of truth

- [SPEC-v0.1.md](SPEC-v0.1.md) — router contract
- [SPEC-mcp-server-v0.md](SPEC-mcp-server-v0.md) — MCP server contract
- [DECISIONS.md](DECISIONS.md), [DECISIONS-py.md](DECISIONS-py.md), [DECISIONS-mcp.md](DECISIONS-mcp.md) — pinned ambiguity resolutions

If a SPEC and the code disagree, the SPEC wins. Open an issue or PR to fix the code, not the spec, unless the spec is demonstrably wrong.
