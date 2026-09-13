# Horos production audit

Audit date: 2026-09-12. Target: private/self-hosted operation first. This report
describes the audited working tree; it is not a claim about the currently hosted
Render deployment until these changes are released there.

## Decision

Horos is suitable for a private pilot as a deterministic context selector and
input-provenance layer. Its local context-pack path now fails closed on source
drift and serialized size. The public repo-cloning MCP service remains a release
candidate until the changed container is built in CI, deployed with independent
secrets, and exercised under representative/adversarial repository load.

Horos does not establish that a model's answer is true. A receipt proves which
graph and selected file hashes were used, how selection replayed, and which key
signed the record. Trust in signer identity still requires an independently
distributed public key. Files omitted by an incomplete graph are outside the
attestation.

## Closed findings

| Severity | Finding | Remediation and evidence |
| --- | --- | --- |
| Critical | The MCP runner used the documented all-zero test seed, so anyone could forge its receipts. | Production startup now requires `HOROS_SIGNING_SEED`, validates a private 32-byte hex seed, and rejects the public test seed. Render declares the secret separately. |
| High | Negative, fractional, or unsafe graph token counts could bypass or corrupt budget arithmetic. | Graph loading and selector overrides require bounded safe integers; regression cases cover negative, fractional, and unsafe values. |
| High | Receipt replay trusted unchecked object shapes and did not compare repository or generator provenance with the supplied graph. | A receipt schema gate now fails closed; replay compares graph hash, repository origin/commit/tree, generator name/version, task, config, manual list, selection, coverage and signature. `--trusted-key` optionally pins signer identity. |
| High | Graph edge endpoints and repository-relative paths were insufficiently constrained. | Loader checks canonical POSIX paths and requires every edge source and resolved target to exist. Generator resolves real paths to prevent sibling-prefix and symlink escapes. |
| High | The MCP response could say `complete` while aliases, dynamic imports, depth limits, budget truncation, or an empty selection left gaps. | The response is `partial` for non-external unresolved edges, truncation/depth exclusions, or empty selection, and includes resolution error classes. |
| High | The final image omitted the TypeScript runtime dependency needed by the generated graph code. | The Docker build prunes development packages and copies production `node_modules`; the image includes an import smoke check for the generator. |
| Medium | Windows entrypoint and dynamic ESM imports used drive paths as URLs and silently failed. | CLI main detection and every runner use `pathToFileURL`; the Python-to-TypeScript parity harness is portable. |
| Medium | Lexical source-token counts are not model-token counts; large strings/comments can look artificially cheap. | The new `workspace_context.mjs` verifies exact source hashes and caps the complete serialized UTF-8 pack. Its private-pilot defaults are 12 files, two graph hops, 12,000 lexical tokens, and 65,536 serialized bytes. It labels lexical counts accurately. |
| Medium | Dependency audit reported two high and two moderate npm findings in the earlier lock. | The lock was refreshed; `npm audit` and `npm audit --omit=dev` report zero known vulnerabilities. |

## Verification

The following checks passed on Windows in this working tree:

- TypeScript: typecheck, build, 99 Vitest tests, and six separate context-pack
  tests. The added cases cover source drift, a huge low-lexical-token literal,
  UTF-8/JSON/receipt overhead, empty selection, and invalid budgets.
- Python generator: 36 tests passed with one Windows-only symlink test skipped
  because the host lacks symlink privilege. The cross-runtime receipt parity test
  executed and passed.
- MCP server: 45 tests passed. Six dependency deprecation warnings remain in its
  current SDK/test-client stack.
- Packaging: `npm pack --dry-run` succeeded and the workspace-only evaluation
  script is excluded from the package. The audited Docker image built, passed its
  embedded import/tool-list checks, then ran as UID 1001 and returned a healthy
  authenticated response with fresh local secrets.
- Supply chain: npm production and full dependency audits reported zero known
  vulnerabilities.
- Cross-project evaluation: seven of seven curated tasks included all expected
  anchor files. With the strict delivery profile the three Horos cases selected
  12 of 30 indexed files and produced packs of 36,264–39,190 bytes. This is a
  small correctness smoke test, not a precision/recall benchmark or load test.

The reproducible evaluation is `python scripts/workspace_eval.py --with-mneme`.
Its latest ignored evidence is under `.local/audit/`.

## Remaining release gates

- Run the full CI matrix on Linux and retain its artifacts. The local Docker build
  and authenticated runtime smoke passed after slow registry downloads; CI still
  needs to reproduce that result before release.
- Benchmark selection quality, peak memory, clone time, cancellation and timeout
  behavior on representative monorepos and hostile repositories. The existing
  README already excludes confidence for repositories above 10,000 files.
- Publish and pin the production receipt public key outside the service. Rotate
  the private seed using the key-management runbook; never reuse server auth as
  the signing seed.
- Add answer-level grounding/evaluation if the product promise expands from
  auditable input to hallucination detection. That is a separate verifier, not a
  safe claim for the current receipt.
