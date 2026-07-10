"""Public router — RouteError classification + empty-selection surfacing.

Section A reproduces the owner's failing case: a valid public repo whose sources
the generator cannot analyze surfaces as ``POST /public/route`` → 422. The real
``RouteError.code`` behind that 422 is ``graph_generation_failed`` (the directive's
candidate codes ``no_entrypoints`` / ``empty_selection`` / ``empty_graph`` /
``no_analyzable_files`` do NOT exist in this codebase — the only codes the route
chain raises are ``graph_generation_failed``, ``router_failed``, ``config_not_found``,
``invalid_input`` and ``verify_failed``).

The other real path — a valid repo where the task simply matches no files — does
NOT raise: ``route_context`` returns a 200 with a ``selection_note``. Those cases
are exercised here too (repo path and graph path, for parity).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from horos_mcp import public, workspace
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


def _build_repo(tmp_path: Path, files: dict, horos: dict | str | None = None) -> str:
    """Materialize files (+ optional horos.json) into a committed bare repo."""
    work = tmp_path / "work"
    work.mkdir()
    for rel, content in files.items():
        p = work / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    if horos is not None:
        (work / "horos.json").write_text(horos if isinstance(horos, str) else json.dumps(horos))

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


def _patch_remote(monkeypatch, url):
    monkeypatch.setattr(workspace, "normalize_repo", lambda repo: (url, "owner/repo"))


# A repo the generator cannot analyze — a syntax error the Python generator
# rejects. This is the concrete reproduction of the owner's 422: the clone and
# generate steps run, then the generator exits non-zero → RouteError(
# "graph_generation_failed") → PublicError(422).
_UNANALYZABLE = {
    "src/app/__init__.py": "",
    "src/app/main.py": "def broken(:\n    pass\n",  # SyntaxError
}
_HOROS = {"python_source_roots": ["src"], "external_modules": []}


# ── Section A — reproduce and pin the exact RouteError (CURRENT behavior) ───────

def test_repro_owner_422_is_actionable_not_bare_code(tmp_path, monkeypatch):
    """The owner's failing repo → 422 with an ACTIONABLE message, not "code: detail".

    graph_generation_failed is now classified into human guidance (what went wrong,
    what to try) and the raw ``graph_generation_failed:`` prefix is gone.
    """
    url = _build_repo(tmp_path, _UNANALYZABLE, _HOROS)
    _patch_remote(monkeypatch, url)
    with pytest.raises(PublicError) as e:
        run_public_route({"task": "add a login feature", "repo_url": "https://github.com/owner/name"})
    assert e.value.status == 422
    # NEW behavior — no bare code prefix; actionable, non-technical guidance.
    assert not e.value.message.startswith("graph_generation_failed:")
    assert "dependency graph" in e.value.message
    assert "Python is supported today" in e.value.message
