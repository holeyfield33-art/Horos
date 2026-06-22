# Changelog

All notable changes to Horos are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
