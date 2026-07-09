"""Section 2 — CORS is scoped to /public/route and the Pages origin only.

The preflight OPTIONS is answered, POST responses carry the allow-list, and the
rest of the app (e.g. /mcp) gets no CORS headers.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from horos_mcp import public
from horos_mcp.public import ALLOW_ORIGIN
from horos_mcp.server import build_app, build_mcp

SECRET = "public-cors-secret"
_GRAPH = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "graph" / "valid-graph.json"


@pytest.fixture
def client():
    public._HITS.clear()
    with TestClient(build_app(build_mcp(), SECRET)) as c:
        yield c
    public._HITS.clear()


def test_preflight_options_answered(client):
    resp = client.options(
        "/public/route",
        headers={
            "Origin": ALLOW_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert resp.status_code == 204
    assert resp.headers["access-control-allow-origin"] == ALLOW_ORIGIN
    assert "POST" in resp.headers["access-control-allow-methods"]
    assert "OPTIONS" in resp.headers["access-control-allow-methods"]
    assert "Content-Type" in resp.headers["access-control-allow-headers"]


def test_post_response_carries_cors(client):
    graph = json.loads(_GRAPH.read_text())
    resp = client.post("/public/route", json={"task": "helper util", "graph": graph})
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == ALLOW_ORIGIN


def test_error_response_carries_cors(client):
    resp = client.post("/public/route", json={"graph": {}})  # missing task → 400
    assert resp.status_code == 400
    assert resp.headers["access-control-allow-origin"] == ALLOW_ORIGIN


def test_mcp_has_no_cors_headers(client):
    """CORS must NOT be relaxed on /mcp."""
    resp = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        headers={"accept": "application/json, text/event-stream"},
    )
    assert "access-control-allow-origin" not in resp.headers
