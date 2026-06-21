# Pinned decisions — Horos MCP server (v0.4 build)

Companion to `DECISIONS.md` / `DECISIONS-py.md` for the new service under `mcp/`. The
server WRAPS the verified Python generator (`python/graph-gen-python/`) and the frozen TS
router (`dist/`). It changes NOTHING in the router, receipt schema, canonical layer, verify
CLI, the TS generator, or the Python generator. Source of truth: `SPEC-mcp-server-v0.md`
and the v0.4 build directives.

## Server placement — directive "decisions to surface"

- **`mcp/` at repo root** (not `python/horos-mcp/`). The M3 Dockerfile copies `dist/`, the
  `python/graph-gen-python/` package, and `mcp/` into one image; a repo-root location keeps
  the polyglot service a peer of both runtimes it orchestrates rather than nesting it under
  one of them.

## `mcp` SDK `run()` signature — VERIFIED, differs from the spec snippet

- Installed SDK: **`mcp==1.28.0`**. The actual signature is
  `FastMCP.run(self, transport='stdio', mount_path=None)` — it does **NOT** accept
  `host`/`port`. The spec §8 / directive M0 snippet
  `mcp.run(transport="streamable-http", host="0.0.0.0", port=...)` would raise `TypeError`
  on this version.
- **Followed the SDK, flagged the difference** (directive: "If the SDK API differs from the
  spec's snippet, follow the SDK and flag the difference"). Host/port are set on the
  `FastMCP(...)` constructor (`host=`, `port=`); the bearer-auth ASGI middleware is added to
  the Starlette app returned by `streamable_http_app()`, which is then served by `uvicorn`.
  This is also what lets the auth check run *before* any tool dispatch (spec §8).
- The streamable-HTTP MCP endpoint path is the SDK default `/mcp`.

## Bearer auth — spec §8

- Pure-ASGI middleware wrapping the FastMCP Starlette app. Constant-time comparison via
  `hmac.compare_digest`. Missing `HOROS_SERVER_SECRET` at boot is a **hard fail** (the
  process refuses to start rather than run unauthenticated).
- `GET /healthz` bypasses auth (Render health check) and returns 200; everything else
  requires `Authorization: Bearer ${HOROS_SERVER_SECRET}`.
- Secrets come from env vars only and are never logged or echoed in responses/errors.

## Resource caps — spec §8, "decisions to surface"

Chosen starting bounds (spec §8 defaults, conservative for Render's smaller plans):

| Cap | Value | Env override |
|-----|-------|--------------|
| Clone timeout | 60 s | `HOROS_CLONE_TIMEOUT_S` |
| Generation timeout | 120 s | `HOROS_GEN_TIMEOUT_S` |
| Router timeout | 120 s | `HOROS_ROUTER_TIMEOUT_S` |
| Max tracked file count (post-clone) | 50000 | `HOROS_MAX_FILES` |
| Max workspace size on disk | 500 MB | `HOROS_MAX_BYTES` |

## Host allowlist — spec §8

- `github.com` only. HTTPS only. `owner/repo` shorthand expands to
  `https://github.com/owner/repo.git`. Non-github hosts, non-https schemes, and
  `--recurse-submodules` are rejected. Credentials are never accepted from tool input;
  private access uses the server's read-only `GITHUB_TOKEN` via server-side URL rewrite.

## `suggested_external_modules` — reconciliation of spec §6 vs directive M2

- Spec §6's *example* shows `suggested_external_modules` = `unresolved_symbols`
  (`["requests","PIL"]`), split from `module_not_found` (`["totally_missing_pkg"]`).
- Directive M2 says `suggested_external_modules` = the distinct `module_not_found`
  top-levels from the generator's completion report.
- The generator (`DECISIONS-py.md`) classifies **any** non-stdlib, non-configured import as
  `module_not_found`; it has no separate "symbol vs module" bucket, so `requests`/`PIL`/
  `totally_missing_pkg` would all be `module_not_found`. The §6 split is illustrative.
- **Reconciliation (implementable + authoritative):**
  - `unresolved_signal.module_not_found` and `suggested_external_modules` ← the distinct
    `module_not_found` top-level specifiers read from the generated graph artifact (the
    generator's own output / completion-report source).
  - `unresolved_signal.unresolved_symbols` ← the router selection's
    `coverage.unresolved_symbols` (a distinct, router-side signal).
  - All three §6 fields are populated; `suggested_external_modules` is non-empty exactly
    when the graph is `partial`.

## Router invocation — "the one thing that must hold"

- M2's router step mirrors the **P5 parity harness**
  (`python/graph-gen-python/tests/parity/verify_parity.mjs`) exactly:
  `loadGraphArtifact → selectContext → buildReceipt → verifyReceipt`, against the built
  `dist/`. A new node runner (`mcp/router_runner.mjs`) reuses that same sequence and emits
  structured JSON; it does not re-implement or modify the router or the parity script.
- The server asserts `verifyReceipt(...).pass === true` before returning. If a receipt does
  not verify, or a `partial` graph would be returned as `complete`, the call errors — green
  tests do not override this.

## Graph source — locked, spec §2

- Decision **A**: graph generated in-request. No `graph_source` receipt field. The frozen
  receipt schema is untouched. Option C is deferred (spec §9).
