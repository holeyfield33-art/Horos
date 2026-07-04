# Horos MCP server

A Render-hosted [MCP](https://modelcontextprotocol.io) server exposing two tools:

- **`route_context`** — clones a committed repo, auto-detects its language (TypeScript
  or Python), generates its dependency graph **in request**, routes the minimal context
  for a task through the **unchanged** TS router (`dist/`), and returns the selected
  files plus a signed, verified receipt.
- **`verify_receipt`** — verifies a receipt against its graph artifact and task text
  without cloning any repository. Third-party auditors use this to confirm that a
  receipt is authentic given only the receipt, the graph, and the task string.

Both tools wrap proven components and change none of them. Source of truth:
[`../SPEC-mcp-server-v0.md`](../SPEC-mcp-server-v0.md); design decisions in
[`../DECISIONS-mcp.md`](../DECISIONS-mcp.md).

## Tools

### `route_context`

`route_context(repo, task, ref=None, config="horos.json", manual_include=[], include_artifacts=False)`

- `repo` — `owner/repo` shorthand or an `https://github.com/...` URL (github.com only).
- `task` — what the context is for (drives selection).
- `ref` — branch, tag, or commit SHA. Default: the remote default branch HEAD.
- `config` — repo-relative path to `horos.json`. Default: `horos.json`. Used for Python
  repos only; ignored when a `tsconfig.json` is detected.
- `manual_include` — extra paths to record in the receipt.
- `include_artifacts` — when `True`, the response also contains `receipt_document`
  (the full signed Receipt object) and `graph_document` (the full graph artifact),
  enabling a direct `verify_receipt` round-trip without any additional cloning.
  If the serialised graph exceeds `HOROS_MAX_ARTIFACT_BYTES` (default 2 MB) both
  documents are omitted and `artifacts_omitted` is set instead; the call never fails
  over artifact size.

**Language detection** (in priority order):
1. `horos.json` present → Python generator path (explicit signal).
2. `horos.json` absent + `tsconfig.json` present → TypeScript generator path.
3. Neither present → Python path with synthesised config (`config_synthesized: true`
   in the response, probing `src/`, `lib/`, `app/` for source roots).

Returns the selected files, exclusions, the receipt summary (hashes + `verified: true`),
and — when an **unlisted** third-party import is found — `selection_status: "partial"`
with an `unresolved_signal` and a `suggested_external_modules` list to add to `horos.json`
and re-run. When selection is empty, `selection_note` provides actionable guidance derived
from real graph signals (partial completeness, unresolved modules, synthesised config).
A partial result is never reported as complete, and a receipt that does not verify is an
error, never a result.

**Composition example** — route then verify without re-cloning:

```python
import asyncio, os
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = os.environ["HOROS_MCP_URL"].rstrip("/") + "/mcp"
HEADERS = {"Authorization": f"Bearer {os.environ['HOROS_SERVER_SECRET']}"}

async def main():
    async with streamablehttp_client(URL, headers=HEADERS) as (r, w, _):
        async with ClientSession(r, w) as s:
            await s.initialize()
            resp = (await s.call_tool("route_context", {
                "repo": "owner/repo",
                "task": "add login flow",
                "include_artifacts": True,
            })).structuredContent

            vfy = (await s.call_tool("verify_receipt", {
                "receipt": resp["receipt_document"],
                "graph":   resp["graph_document"],
                "task":    "add login flow",
            })).structuredContent
            assert vfy["pass"] is True

asyncio.run(main())
```

### `verify_receipt`

`verify_receipt(receipt, graph, task, manual_include=[])`

- `receipt` — the receipt JSON object to verify.
- `graph` — the graph artifact JSON object the receipt was produced from.
- `task` — the original task text.
- `manual_include` — the manual-include list used when routing (default: empty).

Returns `{"pass": true}` on success, or `{"pass": false, "field": "...", "detail": "..."}`
identifying the exact diverging field on failure. No repository clone is needed — all
verification inputs are supplied inline.

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `HOROS_SERVER_SECRET` | yes | Bearer token required on every MCP request. Missing at boot = the server refuses to start. |
| `GITHUB_TOKEN` | for private repos | Read-only (`contents` scope) token. Injected server-side into the clone URL; never accepted from tool input, never logged. |
| `PORT` | provided by Render | Listen port (default `8000` locally). |
| `HOROS_CLONE_TIMEOUT_S` / `HOROS_GEN_TIMEOUT_S` / `HOROS_ROUTER_TIMEOUT_S` | no | Stage timeouts (default 60 / 120 / 120 s). |
| `HOROS_MAX_FILES` / `HOROS_MAX_BYTES` | no | Workspace caps (default 50000 files / 500 MB). |
| `HOROS_MAX_ARTIFACT_BYTES` | no | Graph size threshold for `include_artifacts` (default 2000000 = 2 MB). Graphs above this omit both documents and set `artifacts_omitted`. |

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

The image runs a build-time smoke test that both runtimes work and both tools
(`route_context` and `verify_receipt`) are listed.

## Deploy to Render

`mcp/render.yaml` defines a Docker web service with `healthCheckPath: /healthz` and the
two secrets (`HOROS_SERVER_SECRET`, `GITHUB_TOKEN`). After deploy, set both secrets in the
Render dashboard.

## Connect from an MCP client

Add a streamable-HTTP MCP connector pointing at:

- **URL:** `https://<your-render-service>.onrender.com/mcp`
- **Header:** `Authorization: Bearer <HOROS_SERVER_SECRET>`

Then call `route_context` or `verify_receipt` (see the live acceptance script in
[`ACCEPTANCE.md`](ACCEPTANCE.md)).

## Tests

```bash
pip install -r mcp/requirements-dev.txt
npm ci && npm run build           # router_runner.mjs needs dist/
cd mcp && python -m pytest -q
```
