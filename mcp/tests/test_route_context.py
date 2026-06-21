"""M2 — route_context full chain (SPEC §3, §5, §6).

These are the real tests: they run the actual clone → generate → route chain end to
end against inline git fixtures (a local bare repo stands in for the remote). The
load-bearing invariant is asserted directly — the receipt verifies, and a partial
graph is never reported as complete.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from horos_mcp import router, workspace
from horos_mcp.router import RouteError, _generate_graph, _run_router, route_context

# A "complete" fixture: all deps listed/internal. main imports an internal module and
# stdlib json (an external_boundary, which must NOT flip status to partial).
COMPLETE_FILES = {
    "src/app/__init__.py": "",
    "src/app/main.py": "import json\nfrom .util import helper\n\n\ndef run():\n    return helper()\n",
    "src/app/util.py": "def helper():\n    return 1\n",
}
COMPLETE_HOROS = {"python_source_roots": ["src"], "external_modules": []}

# A "partial" fixture: an UNLISTED third-party import => module_not_found.
PARTIAL_FILES = {
    "src/app/__init__.py": "",
    "src/app/main.py": "import totally_missing_pkg\nfrom .util import helper\n",
    "src/app/util.py": "def helper():\n    return 1\n",
}
PARTIAL_HOROS = {"python_source_roots": ["src"], "external_modules": []}


def _build_repo(tmp_path: Path, files: dict, horos: dict | str) -> str:
    """Materialize files + horos.json into a committed bare repo; return its file URL."""
    work = tmp_path / "work"
    work.mkdir()
    for rel, content in files.items():
        p = work / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    horos_text = horos if isinstance(horos, str) else json.dumps(horos)
    (work / "horos.json").write_text(horos_text)

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


@pytest.fixture(autouse=True)
def _no_token(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)


def _patch_remote(monkeypatch, url):
    monkeypatch.setattr(workspace, "normalize_repo", lambda repo: (url, "owner/repo"))


def test_complete_repo(tmp_path, monkeypatch):
    url = _build_repo(tmp_path, COMPLETE_FILES, COMPLETE_HOROS)
    _patch_remote(monkeypatch, url)

    resp = route_context("owner/repo", task="helper util")
    assert resp["selection_status"] == "complete"
    assert resp["unresolved_signal"] is None
    assert resp["suggested_external_modules"] == []
    assert resp["receipt"]["verified"] is True
    assert resp["receipt"]["receipt_hash"]
    assert len(resp["selected_files"]) >= 1


def test_partial_repo_with_unlisted_import(tmp_path, monkeypatch):
    url = _build_repo(tmp_path, PARTIAL_FILES, PARTIAL_HOROS)
    _patch_remote(monkeypatch, url)

    resp = route_context("owner/repo", task="helper util")
    assert resp["selection_status"] == "partial"
    assert "totally_missing_pkg" in resp["suggested_external_modules"]
    assert "totally_missing_pkg" in resp["unresolved_signal"]["module_not_found"]
    assert resp["unresolved_signal"]["warning"]
    # The selection is STILL returned — partial is not an error.
    assert resp["receipt"]["verified"] is True
    assert isinstance(resp["selected_files"], list)


def test_determinism_same_inputs_same_receipt(tmp_path, monkeypatch):
    url = _build_repo(tmp_path, COMPLETE_FILES, COMPLETE_HOROS)
    _patch_remote(monkeypatch, url)
    a = route_context("owner/repo", task="helper util")
    b = route_context("owner/repo", task="helper util")
    assert a["receipt"]["receipt_hash"] == b["receipt"]["receipt_hash"]


def test_generator_failure_is_clean_tool_error(tmp_path, monkeypatch):
    # Malformed horos.json (missing required keys) => generator exits non-zero.
    url = _build_repo(tmp_path, COMPLETE_FILES, "{}")
    _patch_remote(monkeypatch, url)
    with pytest.raises(RouteError) as exc:
        route_context("owner/repo", task="helper")
    assert exc.value.code == "graph_generation_failed"


def test_missing_config_is_clean_tool_error(tmp_path, monkeypatch):
    url = _build_repo(tmp_path, COMPLETE_FILES, COMPLETE_HOROS)
    _patch_remote(monkeypatch, url)
    with pytest.raises(RouteError) as exc:
        route_context("owner/repo", task="helper", config="does-not-exist.json")
    assert exc.value.code == "config_not_found"


def test_generator_stderr_secret_is_scrubbed(tmp_path, monkeypatch):
    token = "ghp_supersecret_value"
    monkeypatch.setenv("GITHUB_TOKEN", token)

    class P:
        returncode = 2
        stderr = f"error: failed cloning https://x-access-token:{token}@github.com/x".encode()
        stdout = b""

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: P())
    with pytest.raises(RouteError) as exc:
        _generate_graph(
            tmp_path, tmp_path / "horos.json", tmp_path / "g.json",
            origin="https://github.com/o/r.git", sha="abc", iso="2026-01-01T00:00:00+00:00",
        )
    assert token not in str(exc.value)
    assert exc.value.code == "graph_generation_failed"


def test_router_failure_surfaces_cleanly(tmp_path, monkeypatch):
    class P:
        returncode = 1
        stdout = json.dumps({"ok": False, "field": "graph", "detail": "boom"}).encode()
        stderr = b""

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: P())
    with pytest.raises(RouteError) as exc:
        _run_router(tmp_path / "g.json", "task", [])
    assert exc.value.code == "router_failed"


def test_router_unverified_receipt_is_rejected(tmp_path, monkeypatch):
    # ok:true but verified:false must NEVER be returned — it errors.
    class P:
        returncode = 0
        stdout = json.dumps({"ok": True, "verified": False}).encode()
        stderr = b""

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: P())
    with pytest.raises(RouteError) as exc:
        _run_router(tmp_path / "g.json", "task", [])
    assert exc.value.code == "router_failed"
