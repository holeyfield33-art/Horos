"""M0 acceptance — bearer auth + server skeleton (SPEC §1, §8).

No live port: the streamable-HTTP app is exercised in-process via Starlette's
TestClient, and the tool list via the FastMCP in-process API.
"""

from __future__ import annotations

import asyncio

import pytest
from starlette.testclient import TestClient

from horos_mcp.auth import BearerAuthMiddleware
from horos_mcp.server import build_app, build_mcp, require_secret

SECRET = "test-secret-value"
MCP_PATH = "/mcp"
# A minimal MCP initialize body — enough to get past auth into the MCP layer.
INIT_BODY = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "0"},
    },
}
MCP_HEADERS = {"content-type": "application/json", "accept": "application/json, text/event-stream"}


@pytest.fixture()
def client():
    mcp = build_mcp()
    app = build_app(mcp, SECRET)
    with TestClient(app) as c:
        yield c


def test_healthz_needs_no_auth(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_missing_token_rejected(client):
    resp = client.post(MCP_PATH, json=INIT_BODY, headers=MCP_HEADERS)
    assert resp.status_code == 401


def test_wrong_token_rejected(client):
    headers = {**MCP_HEADERS, "authorization": "Bearer not-the-secret"}
    resp = client.post(MCP_PATH, json=INIT_BODY, headers=headers)
    assert resp.status_code == 401


def test_correct_token_passes_auth(client):
    headers = {**MCP_HEADERS, "authorization": f"Bearer {SECRET}"}
    resp = client.post(MCP_PATH, json=INIT_BODY, headers=headers)
    # Auth passed: the MCP layer now owns the response, whatever it decides.
    assert resp.status_code != 401


def test_middleware_requires_secret():
    with pytest.raises(RuntimeError):
        BearerAuthMiddleware(app=lambda *_: None, secret="")


def test_require_secret_hard_fails(monkeypatch):
    monkeypatch.delenv("HOROS_SERVER_SECRET", raising=False)
    with pytest.raises(RuntimeError):
        require_secret()


def test_require_secret_reads_env(monkeypatch):
    monkeypatch.setenv("HOROS_SERVER_SECRET", "abc")
    assert require_secret() == "abc"


def test_route_context_tool_is_listed():
    mcp = build_mcp()
    tools = asyncio.run(mcp.list_tools())
    names = [t.name for t in tools]
    assert "route_context" in names
    tool = next(t for t in tools if t.name == "route_context")
    props = tool.inputSchema.get("properties", {})
    assert {"repo", "task"}.issubset(props.keys())
