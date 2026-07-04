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
from horos_mcp.verifier import verify_receipt as _verify_receipt

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


# ---------------------------------------------------------------------------
# Task 2 — include_artifacts / verify_receipt composition
# ---------------------------------------------------------------------------

def test_include_artifacts_enables_verify_receipt_composition(tmp_path, monkeypatch):
    """include_artifacts=True → receipt_document + graph_document; round-trip verifies."""
    url = _build_repo(tmp_path, COMPLETE_FILES, COMPLETE_HOROS)
    _patch_remote(monkeypatch, url)

    resp = route_context("owner/repo", task="helper util", include_artifacts=True)

    assert "receipt_document" in resp, "receipt_document missing when include_artifacts=True"
    assert "graph_document" in resp, "graph_document missing when include_artifacts=True"
    assert "artifacts_omitted" not in resp

    # Composition: feed the artifacts directly into verify_receipt.
    vpass = _verify_receipt(resp["receipt_document"], resp["graph_document"], "helper util")
    assert vpass["pass"] is True

    # Mutated task → fail on task.task_hash.
    vfail = _verify_receipt(resp["receipt_document"], resp["graph_document"], "TAMPERED helper util")
    assert vfail["pass"] is False
    assert vfail["field"] == "task.task_hash"


def test_default_call_has_no_artifact_docs(tmp_path, monkeypatch):
    """Default route_context (include_artifacts=False) exposes no artifact keys."""
    url = _build_repo(tmp_path, COMPLETE_FILES, COMPLETE_HOROS)
    _patch_remote(monkeypatch, url)

    resp = route_context("owner/repo", task="helper util")
    assert "receipt_document" not in resp
    assert "graph_document" not in resp
    assert "artifacts_omitted" not in resp


def test_artifacts_omitted_when_graph_too_large(tmp_path, monkeypatch):
    """When graph exceeds size cap, artifacts_omitted is set and documents absent."""
    url = _build_repo(tmp_path, COMPLETE_FILES, COMPLETE_HOROS)
    _patch_remote(monkeypatch, url)

    monkeypatch.setattr(router, "_MAX_ARTIFACT_BYTES", 1)  # force any graph to exceed
    resp = route_context("owner/repo", task="helper util", include_artifacts=True)

    assert "receipt_document" not in resp
    assert "graph_document" not in resp
    assert "artifacts_omitted" in resp
    assert "exceeds" in resp["artifacts_omitted"]


# ---------------------------------------------------------------------------
# Task 3 — selection_note guidance on empty selection
# ---------------------------------------------------------------------------

def test_shape_response_empty_selection_note_all_signals():
    """_shape_response with empty selection builds note from all three signals."""
    from horos_mcp.router import _shape_response

    fake_router = {
        "receipt": {
            "receipt_hash": "aaa", "task_hash": "bbb",
            "config_hash": "ccc", "graph_artifact_hash": "ddd",
        },
        "selection": [],
        "exclusions": [],
        "coverage": {"files_scanned": 5, "files_selected": 0, "unresolved_symbols": []},
    }
    fake_artifact = {
        "metadata": {
            "completeness": "partial",
            "coverage": {"unresolved_edges": 12},
        },
        "edges": [],
    }
    resp = _shape_response(
        "abc",
        fake_router,
        ["requests"],
        artifact=fake_artifact,
        config_synthesized=True,
    )

    note = resp["selection_note"]
    assert "no entrypoints matched the task" in note
    assert "partial" in note and "12" in note  # partial graph, edge count
    assert "requests" in note                  # suggested external_modules
    assert "horos.json" in note                # config synthesised hint


def test_shape_response_empty_selection_note_minimal():
    """_shape_response without extra signals → minimal note, no conditional parts."""
    from horos_mcp.router import _shape_response

    fake_router = {
        "receipt": {
            "receipt_hash": "aaa", "task_hash": "bbb",
            "config_hash": "ccc", "graph_artifact_hash": "ddd",
        },
        "selection": [],
        "exclusions": [],
        "coverage": {"files_scanned": 1, "files_selected": 0, "unresolved_symbols": []},
    }
    resp = _shape_response("abc", fake_router, [], artifact=None, config_synthesized=False)

    assert "selection_note" in resp
    note = resp["selection_note"]
    assert "no entrypoints matched the task" in note
    assert "partial" not in note
    assert "horos.json" not in note


def test_non_empty_selection_has_no_note(tmp_path, monkeypatch):
    """Non-empty selection must NOT carry a selection_note key."""
    url = _build_repo(tmp_path, COMPLETE_FILES, COMPLETE_HOROS)
    _patch_remote(monkeypatch, url)

    resp = route_context("owner/repo", task="helper util")
    assert len(resp["selected_files"]) >= 1
    assert "selection_note" not in resp
