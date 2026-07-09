"""Section 1 — the public, unauthenticated POST /public/route endpoint.

Covers request validation, the graph-fallback and repo (tokenless) paths, the
response shape ({summary, receipt}), and the abuse limits (413 body cap, 429
per-IP rate limit). The auth-bypass wiring is exercised over real HTTP in
test_public_http.py.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from horos_mcp import public, router, workspace
from horos_mcp.public import PublicError, run_public_route

_REPO_ROOT = Path(__file__).resolve().parents[2]
_GRAPH = _REPO_ROOT / "test" / "fixtures" / "graph" / "valid-graph.json"


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    public._HITS.clear()
    yield
    public._HITS.clear()


@pytest.fixture(autouse=True)
def _no_token(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)


def _graph() -> dict:
    return json.loads(_GRAPH.read_text())


# ── Validation ────────────────────────────────────────────────────────────────

def test_missing_task_rejected():
    with pytest.raises(PublicError) as e:
        run_public_route({"graph": _graph()})
    assert e.value.status == 400 and "task" in e.value.message


def test_neither_repo_nor_graph_rejected():
    with pytest.raises(PublicError) as e:
        run_public_route({"task": "do a thing"})
    assert e.value.status == 400


def test_both_repo_and_graph_rejected():
    with pytest.raises(PublicError) as e:
        run_public_route({"task": "t", "graph": _graph(), "repo_url": "https://github.com/a/b"})
    assert e.value.status == 400 and "exactly one" in e.value.message


def test_non_github_repo_url_rejected():
    with pytest.raises(PublicError) as e:
        run_public_route({"task": "t", "repo_url": "https://gitlab.com/a/b"})
    assert e.value.status == 400


def test_graph_must_be_object():
    with pytest.raises(PublicError) as e:
        run_public_route({"task": "t", "graph": "not-an-object"})
    assert e.value.status == 400


# ── Graph-fallback path ───────────────────────────────────────────────────────

def test_graph_path_returns_summary_and_signed_receipt():
    result = run_public_route({"task": "helper util", "graph": _graph()})
    assert set(result) == {"summary", "receipt"}
    assert set(result["summary"]) == {"selected_files", "excluded_files", "unresolved_symbols"}
    receipt = result["receipt"]
    # A full, signed receipt — not the thin summary the MCP tool returns.
    assert "receipt_hash" in receipt
    assert receipt["signature"]["algorithm"] == "Ed25519"
    assert len(receipt["signature"]["value"]) == 128  # Ed25519 sig hex


def test_malformed_graph_is_clean_error():
    with pytest.raises(PublicError) as e:
        run_public_route({"task": "t", "graph": {"not": "a graph"}})
    assert e.value.status == 422


# ── Repo path (tokenless) ─────────────────────────────────────────────────────

def _build_repo(tmp_path: Path) -> str:
    work = tmp_path / "work"
    work.mkdir()
    (work / "src" / "app").mkdir(parents=True)
    (work / "src" / "app" / "__init__.py").write_text("")
    (work / "src" / "app" / "main.py").write_text("from .util import helper\n\n\ndef run():\n    return helper()\n")
    (work / "src" / "app" / "util.py").write_text("def helper():\n    return 1\n")
    (work / "horos.json").write_text(json.dumps({"python_source_roots": ["src"], "external_modules": []}))

    def g(*a):
        subprocess.run(["git", "-C", str(work), *a], check=True, capture_output=True)

    subprocess.run(["git", "init", "-q", "-b", "main", str(work)], check=True)
    g("config", "user.email", "t@example.com")
    g("config", "user.name", "T")
    g("add", "-A")
    g("commit", "-q", "-m", "init")
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(work), str(bare)], check=True)
    return f"file://{bare}"


def test_repo_path_never_uses_github_token(tmp_path, monkeypatch):
    """The public repo path must clone TOKENLESS — GITHUB_TOKEN is never injected."""
    url = _build_repo(tmp_path)
    monkeypatch.setattr(workspace, "normalize_repo", lambda repo: (url, "owner/repo"))
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_should_never_be_used")

    # Spy on the URL handed to git: it must be the clean file:// URL, never an
    # x-access-token authed URL.
    real_clone_into = workspace._clone_into
    seen_urls: list[str] = []

    def spy(url_arg, ref, dest, *, token):
        seen_urls.append(url_arg)
        assert token is None, "public path must pass token=None to the clone"
        return real_clone_into(url_arg, ref, dest, token=token)

    monkeypatch.setattr(workspace, "_clone_into", spy)

    result = run_public_route({"task": "helper util", "repo_url": "https://github.com/owner/name"})
    assert "receipt_hash" in result["receipt"]
    assert seen_urls, "clone was never invoked"
    for u in seen_urls:
        assert "x-access-token" not in u
        assert "ghp_should_never_be_used" not in u


# ── Rate limit unit ───────────────────────────────────────────────────────────

def test_rate_limiter_trips_at_budget(monkeypatch):
    monkeypatch.setattr(public, "RATE_LIMIT", 3)
    monkeypatch.setattr(public, "RATE_WINDOW_S", 300)
    public._HITS.clear()
    ip = "1.2.3.4"
    assert public._rate_limited(ip, now=0.0) is False
    assert public._rate_limited(ip, now=1.0) is False
    assert public._rate_limited(ip, now=2.0) is False
    assert public._rate_limited(ip, now=3.0) is True  # 4th within window → limited
    # A far-future request (outside the window) is allowed again.
    assert public._rate_limited(ip, now=400.0) is False
