# Horos MCP server

A Render-hosted [MCP](https://modelcontextprotocol.io) server exposing one tool,
`route_context`, that clones a committed repo, generates its dependency graph **in
request** (the verified Python generator), routes the minimal context for a task through
the **unchanged** TS router (`dist/`), and returns the selected files plus a signed,
verified receipt.

It wraps proven components and changes none of them. Source of truth:
[`../SPEC-mcp-server-v0.md`](../SPEC-mcp-server-v0.md); design decisions in
[`../DECISIONS-mcp.md`](../DECISIONS-mcp.md).

## The tool

`route_context(repo, task, ref=None, config="horos.json", manual_include=[])`

- `repo` — `owner/repo` shorthand or an `https://github.com/...` URL (github.com only).
- `task` — what the context is for (drives selection).
- `ref` — branch, tag, or commit SHA. Default: the remote default branch HEAD.
- `config` — repo-relative path to `horos.json`. Default: `horos.json`.
- `manual_include` — extra paths to record in the receipt.

Returns the selected files, exclusions, the receipt summary (hashes + `verified: true`),
and — when an **unlisted** third-party import is found — `selection_status: "partial"`
with an `unresolved_signal` and a `suggested_external_modules` list to add to `horos.json`
and re-run. A partial result is never reported as complete, and a receipt that does not
verify is an error, never a result.

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `HOROS_SERVER_SECRET` | yes | Bearer token required on every MCP request. Missing at boot = the server refuses to start. |
| `GITHUB_TOKEN` | for private repos | Read-only (`contents` scope) token. Injected server-side into the clone URL; never accepted from tool input, never logged. |
| `PORT` | provided by Render | Listen port (default `8000` locally). |
| `HOROS_CLONE_TIMEOUT_S` / `HOROS_GEN_TIMEOUT_S` / `HOROS_ROUTER_TIMEOUT_S` | no | Stage timeouts (default 60 / 120 / 120 s). |
| `HOROS_MAX_FILES` / `HOROS_MAX_BYTES` | no | Workspace caps (default 50000 files / 500 MB). |

## Security posture (§8)

- **Bearer auth** on every request (`Authorization: Bearer ${HOROS_SERVER_SECRET}`),
  checked constant-time by ASGI middleware before any tool runs. `GET /healthz` is the
  only unauthenticated path.
- **github.com only**, HTTPS only. Non-github hosts, non-https schemes, embedded
  credentials, and submodule recursion are rejected.
- **Read-only** GitHub token; secrets come from env only and are scrubbed from errors.

## Run locally

```bash
pip install -r mcp/requirements.txt
npm ci && npm run build           # produces dist/
export HOROS_SERVER_SECRET=dev-secret
PYTHONPATH=mcp PORT=8000 python -m horos_mcp.server
# MCP endpoint: http://localhost:8000/mcp   health: http://localhost:8000/healthz
```

## Build the container

The Dockerfile lives at `mcp/Dockerfile` but builds from the **repo root** (it compiles
`dist/` from `src/` and includes the generator):

```bash
docker build -f mcp/Dockerfile -t horos-mcp .
docker run --rm -e HOROS_SERVER_SECRET=dev-secret -e PORT=8000 -p 8000:8000 horos-mcp
```

The image runs a build-time smoke test that both runtimes work and `route_context` is
listed.

## Deploy to Render

`mcp/render.yaml` defines a Docker web service with `healthCheckPath: /healthz` and the
two secrets (`HOROS_SERVER_SECRET`, `GITHUB_TOKEN`). After deploy, set both secrets in the
Render dashboard.

## Connect from an MCP client

Add a streamable-HTTP MCP connector pointing at:

- **URL:** `https://<your-render-service>.onrender.com/mcp`
- **Header:** `Authorization: Bearer <HOROS_SERVER_SECRET>`

Then call `route_context` (see the live acceptance script in
[`ACCEPTANCE.md`](ACCEPTANCE.md)).

## Tests

```bash
pip install -r mcp/requirements-dev.txt
npm ci && npm run build           # router_runner.mjs needs dist/
cd mcp && python -m pytest -q
```
