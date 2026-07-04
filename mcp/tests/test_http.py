"""HTTP-level MCP endpoint tests — exercises both tools over a real local server.

Starts a uvicorn instance in a background thread with mocked route/verify
functions (so no real git clone happens), then calls both tools via the
official MCP ClientSession + streamablehttp_client path.  This covers the
full request chain: auth middleware → FastMCP dispatch → tool handler.

Why not TestClient?  starlette.testclient.TestClient uses a sync WSGI-like
transport that doesn't interoperate with the async MCP SDK's SSE stream
reader (streamablehttp_client).  A real HTTP server in a thread is the
minimal change that makes both sides work together.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from unittest.mock import patch

import httpx
import pytest
import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from horos_mcp.server import build_app, build_mcp

# ── Constants ────────────────────────────────────────────────────────────────

SECRET = "http-level-test-secret"


def _free_port() -> int:
    """Return an ephemeral port number guaranteed free at the point of binding."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

# ── Fixture responses (no real git clone needed) ──────────────────────────────

_MOCK_RC = {
    "repo_commit": "abc123def456",
    "selection_status": "complete",
    "selected_files": [{"path": "src/main.py", "rank": 1, "token_count": 120}],
    "exclusions": [],
    "unresolved_signal": None,
    "suggested_external_modules": [],
    "receipt": {
        "receipt_hash": "deadbeef00112233",
        "verified": True,
        "task_hash": "cafebabe44556677",
        "config_hash": "00000001",
        "graph_artifact_hash": "ffffffff",
    },
}

_MOCK_VR = {"pass": True}


# ── Server fixture (module-scoped) ────────────────────────────────────────────

@pytest.fixture(scope="module")
def server_url():
    """Start the MCP server on a local port with mocked tools; yield the base URL.

    Patches horos_mcp.server._route_context and _verify_receipt so the test
    never clones a real repo.  The server runs for the lifetime of the module.
    """
    port = _free_port()
    with (
        patch("horos_mcp.server._route_context", return_value=_MOCK_RC),
        patch("horos_mcp.server._verify_receipt", return_value=_MOCK_VR),
    ):
        mcp = build_mcp()
        app = build_app(mcp, SECRET)
        config = uvicorn.Config(
            app, host="127.0.0.1", port=port, log_level="critical"
        )
        srv = uvicorn.Server(config)
        t = threading.Thread(target=srv.run, daemon=True)
        t.start()

        # Poll until ready (max 5 s).
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            try:
                httpx.get(f"http://127.0.0.1:{port}/healthz", timeout=0.3)
                break
            except Exception:
                time.sleep(0.1)
        else:
            srv.should_exit = True
            pytest.fail("Local MCP test server did not start within 5 s")

        yield f"http://127.0.0.1:{port}"

        srv.should_exit = True
        t.join(timeout=5)


# ── Async helper ──────────────────────────────────────────────────────────────

async def _call_tool(base_url: str, tool: str, args: dict) -> dict:
    url = f"{base_url}/mcp"
    headers = {"Authorization": f"Bearer {SECRET}"}
    async with streamablehttp_client(url, headers=headers) as (r, w, _):
        async with ClientSession(r, w) as session:
            await session.initialize()
            result = await session.call_tool(tool, args)
            if result.structuredContent:
                return result.structuredContent
            for part in result.content:
                if hasattr(part, "text"):
                    return json.loads(part.text)
            raise AssertionError(f"Unexpected result shape from {tool}: {result!r}")


async def _list_tool_names(base_url: str) -> list[str]:
    url = f"{base_url}/mcp"
    headers = {"Authorization": f"Bearer {SECRET}"}
    async with streamablehttp_client(url, headers=headers) as (r, w, _):
        async with ClientSession(r, w) as session:
            await session.initialize()
            result = await session.list_tools()
            return [t.name for t in result.tools]


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_healthz_no_auth_required(server_url):
    """GET /healthz is unauthenticated and returns {\"status\": \"ok\"}."""
    resp = httpx.get(f"{server_url}/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_unauthenticated_mcp_returns_401(server_url):
    """POST /mcp without Authorization header is rejected with 401."""
    resp = httpx.post(
        f"{server_url}/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        headers={
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
        },
    )
    assert resp.status_code == 401


def test_both_tools_listed_over_http(server_url):
    """list_tools over the live HTTP endpoint returns route_context and verify_receipt."""
    names = asyncio.run(_list_tool_names(server_url))
    assert "route_context" in names, f"route_context missing from {names}"
    assert "verify_receipt" in names, f"verify_receipt missing from {names}"


def test_route_context_returns_expected_shape(server_url):
    """route_context tool returns the §3 response shape over HTTP."""
    resp = asyncio.run(_call_tool(server_url, "route_context", {
        "repo": "owner/repo",
        "task": "add login endpoint",
    }))
    assert resp["selection_status"] == "complete"
    assert resp["receipt"]["verified"] is True
    assert resp["selected_files"], "selected_files must be non-empty in mock response"


def test_verify_receipt_returns_pass(server_url):
    """verify_receipt tool returns {pass: true} for the mocked response."""
    resp = asyncio.run(_call_tool(server_url, "verify_receipt", {
        "receipt": {"receipt_hash": "x"},
        "graph": {},
        "task": "add login endpoint",
    }))
    assert resp["pass"] is True
