"""Section 1 (HTTP) — /public/route over the real wired app.

Uses starlette's TestClient against build_app to prove the auth carve-out and the
abuse limits at the HTTP layer: /public/route is reachable WITHOUT a bearer token
while /mcp stays behind the 401 wall, oversized bodies get 413, and the per-IP
rate limit returns 429. The graph path signs for real (conftest sets a test seed).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from horos_mcp import public
from horos_mcp.server import build_app, build_mcp

SECRET = "public-http-secret"
_GRAPH = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "graph" / "valid-graph.json"


@pytest.fixture
def client():
    public._HITS.clear()
    app = build_app(build_mcp(), SECRET)
    with TestClient(app) as c:
        yield c
    public._HITS.clear()


def test_public_route_is_unauthenticated(client):
    """No Authorization header, yet /public/route serves a signed receipt."""
    graph = json.loads(_GRAPH.read_text())
    resp = client.post("/public/route", json={"task": "helper util", "graph": graph})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "summary" in body and "receipt_hash" in body["receipt"]


def test_mcp_still_walled(client):
    """The bearer wall is intact everywhere else — /mcp is 401 without a token."""
    resp = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        headers={"accept": "application/json, text/event-stream"},
    )
    assert resp.status_code == 401


def test_body_size_cap_returns_413(client, monkeypatch):
    monkeypatch.setattr(public, "MAX_BODY_BYTES", 50)
    resp = client.post("/public/route", json={"task": "x" * 200, "graph": {}})
    assert resp.status_code == 413


def test_rate_limit_returns_429(client, monkeypatch):
    monkeypatch.setattr(public, "RATE_LIMIT", 2)
    payload = {"task": "t", "graph": {"malformed": True}}
    codes = [client.post("/public/route", json=payload).status_code for _ in range(4)]
    # First 2 are processed (422 malformed graph), then the limiter trips.
    assert codes[0] != 429 and codes[1] != 429
    assert 429 in codes[2:]
