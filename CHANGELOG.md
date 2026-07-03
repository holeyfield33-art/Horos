# Changelog

All notable changes to Horos are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added
- **TypeScript language support in MCP server** (`mcp/`): `route_context` now
  auto-detects TypeScript repos (presence of `tsconfig.json`) and routes them
  through the TS graph generator, resolving the dogfooding gap.
- **Default config synthesis**: when a Python repo has no `horos.json`, the
  server synthesises a minimal config (probing `src/`, `lib/`, `app/`), returning
  `config_synthesized: true` in the response so callers can detect and persist it.
- **`verify_receipt` MCP tool**: third-party auditors can now verify a receipt
  against its graph artifact and task text without cloning the repository. Returns
  `{pass: true}` or `{pass: false, field, detail}` identifying the exact diverging
  field.
- **`horos generate` CLI subcommand**: wraps the TS graph generator;
  `--tsconfig`, `--repo`, `--origin`, `--commit`, `--out`, `--json` flags.
- **`horos route` CLI subcommand**: wraps the selector + receipt builder;
  `<graph.json> <task>`, `--key`, `--out`, `--config`, `--manual`, `--json` flags.
- Both new CLI commands support `--json` for CI-friendly `{ok, graph|receipt}` envelopes.

### Changed
- `DECISIONS.md`: new `selector.version versioning` section documenting that
  `receipt.selector.version` tracks selection-algorithm semantics independently of
  the npm package version and bumps only on selection-output-affecting changes.
- `docs/RECEIPTS.md`: added inline annotation explaining `selector.version` policy.
- `horos verify` help text updated to show all three subcommands.
- CI workflow: `main` branch added to push trigger.
- CI workflow: explicit `permissions: read-all` on all jobs (CodeQL hardening).
- `mcp` dependency: `mcp` bumped 1.28.0 → 1.28.1.

### Fixed
- Path containment check now dereferences symlinks before comparing to workspace
  root, closing a symlink path-escape vector.
- Python test discovery path corrected.

### Security
- Security policy (`SECURITY.md`) rewritten with clearer reporting guidelines and
  scope boundaries.
- CODEOWNERS file added for automatic review assignment.
- Dependabot configured for npm (root), pip (`/python/graph-gen-python`, `/mcp`),
  and GitHub Actions ecosystems.

---

## [0.3.3] — 2026-06-22

### Added
- Community health files: CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG.
- `.github/` scaffolding: issue templates, PR template, CI workflow.
- `package.json`: `bugs` field, `author` field, corrected repo/homepage casing.

---

## [0.3.2] — 2026-06-21

### Changed
- Documentation pass: full README rewrite, Python quickstart, key-management guide, receipts guide.

---

## [0.3.1] — 2026-06-21

### Fixed
- Python resolver: same-named-package layouts (e.g. Django, Requests) now resolve correctly.
  Django measured: 259 → 3,351 resolved edges after the fix.

---

## [0.3.0] — 2026-06-20

### Added
- Python graph generator (`python/graph-gen-python`): static, deterministic dependency-graph producer for Python repos. Passes router parity — a Python-generated graph loads, selects, signs, and verifies through the unchanged TS router.

---

## [0.2.0] — 2026-06-18

### Added
- MCP server (`mcp/`): exposes `generate`, `route`, and `verify` over streamable-HTTP.
- Render hosting configuration (`mcp/render.yaml`, `mcp/Dockerfile`).

---

## [0.1.0] — 2026-06-15

### Added
- Context router core: canonical JSON forms, graph schema and loader, dependency-graph selector, content re-verification, receipt signing (Ed25519), `horos verify` CLI.
- TypeScript graph generator (`scripts/generate.mjs`).
- SPEC-v0.1.md and initial DECISIONS.md.
