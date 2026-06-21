# Live deployment acceptance — Horos MCP server

> Implements SPEC-mcp-server-v0 §10 step 6. This is a **manual** acceptance script run
> against the live Render URL — not a CI test. It is the proof the whole build was for:
> `route_context`, called over the live MCP endpoint, returns a **verified** receipt.

The in-process chain is already covered by `pytest` (M0–M2). This document closes the loop
end to end over the network.

## 0. Prerequisites

- The image deploys on Render from `mcp/render.yaml` (see `README.md`).
- A strong `HOROS_SERVER_SECRET` is set as a Render secret.
- `GITHUB_TOKEN` (read-only, `contents` scope) is set if you will route private repos.
- A target **public Python repo** that has a committed, valid `horos.json`
  (`python_source_roots`, `external_modules`). The router's own repo fixture
  `python/graph-gen-python/tests/fixtures/py-project` is a known-good shape to mirror.

## 1. Deploy + capture the URL

1. Create the Render service from `mcp/render.yaml`; set the two secrets.
2. Wait for the deploy to go live; copy the service URL, e.g.
   `https://horos-mcp.onrender.com`.
3. Record it (and the date) at the bottom of this file and in `README.md` under
   "Connect from an MCP client".

## 2. Liveness + auth gate (curl)

```bash
URL=https://horos-mcp.onrender.com
SECRET=...   # HOROS_SERVER_SECRET

# Health check is unauthenticated and returns {"status":"ok"}.
curl -fsS "$URL/healthz"; echo

# The MCP endpoint rejects a missing/wrong token BEFORE any tool runs (expect 401).
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'   # -> 401
```

## 3. Call `route_context` over the live endpoint (Python MCP client)

```python
# pip install mcp
import asyncio, os
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = os.environ["HOROS_MCP_URL"].rstrip("/") + "/mcp"
HEADERS = {"Authorization": f"Bearer {os.environ['HOROS_SERVER_SECRET']}"}


async def call(repo, task, **kw):
    async with streamablehttp_client(URL, headers=HEADERS) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(
                "route_context", {"repo": repo, "task": task, **kw}
            )
            return result.structuredContent or result.content


async def main():
    # 3a. A good repo with all deps listed -> complete + verified.
    good = await call("OWNER/GOOD_REPO", "describe the feature to work on")
    assert good["receipt"]["verified"] is True, good
    assert good["selection_status"] == "complete", good
    assert good["selected_files"], good
    print("OK complete:", [f["path"] for f in good["selected_files"]])

    # 3b. A repo with an UNLISTED dependency -> partial + suggestions, selection returned.
    partial = await call("OWNER/UNDERCONFIGURED_REPO", "same task")
    assert partial["selection_status"] == "partial", partial
    assert partial["suggested_external_modules"], partial
    assert partial["receipt"]["verified"] is True, partial
    print("OK partial, add to external_modules:", partial["suggested_external_modules"])


asyncio.run(main())
```

## 4. Pass criteria

- [ ] `/healthz` returns `{"status":"ok"}`; unauthenticated `/mcp` returns `401`.
- [ ] `route_context` on the good repo: `receipt.verified == true`,
      `selection_status == "complete"`, `selected_files` matches expectation.
- [ ] `route_context` on the underconfigured repo: `selection_status == "partial"`,
      `suggested_external_modules` populated, selection still returned (not an error).
- [ ] Two identical calls return the same `receipt.receipt_hash` (determinism).

When all four hold, Horos is reachable from chat: add the connector with the URL +
bearer header from `README.md`.

## 5. Record of the working deployment

> Fill in after a successful run.

- Service URL: `https://__________.onrender.com`
- Verified on (date): `__________`
- Good repo / task / `receipt_hash`: `__________`
- Underconfigured repo / `suggested_external_modules`: `__________`
