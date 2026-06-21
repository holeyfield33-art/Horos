"""M1 — clone + workspace lifecycle (SPEC §4, §8).

Network-free: a local bare repo stands in for the remote. The github.com/HTTPS
allowlist is unit-tested directly; the clone/caps/commit-capture mechanics run
against the local bare repo via a monkeypatched ``normalize_repo``.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from horos_mcp import workspace
from horos_mcp.workspace import CloneError, clone_repo, normalize_repo


# --- allowlist / normalization (unit) ---------------------------------------

def test_shorthand_expands_to_github_https():
    url, slug = normalize_repo("owner/repo")
    assert url == "https://github.com/owner/repo.git"
    assert slug == "owner/repo"


def test_https_github_url_accepted_and_stripped():
    url, slug = normalize_repo("https://github.com/owner/repo")
    assert url == "https://github.com/owner/repo.git"
    assert slug == "owner/repo"


@pytest.mark.parametrize(
    "bad",
    [
        "https://gitlab.com/owner/repo",  # non-github host
        "http://github.com/owner/repo",  # non-https
        "git@github.com:owner/repo.git",  # ssh
        "ssh://github.com/owner/repo",  # ssh scheme
        "https://user:pass@github.com/owner/repo",  # embedded credentials
        "",  # empty
    ],
)
def test_rejected_inputs(bad):
    with pytest.raises(CloneError):
        normalize_repo(bad)


# --- clone mechanics against a local bare repo ------------------------------

def _make_bare_repo(tmp_path: Path) -> tuple[str, str]:
    """Create a work repo with one commit, push to a bare repo; return (url, sha)."""
    work = tmp_path / "work"
    work.mkdir()
    run = lambda *a: subprocess.run(["git", "-C", str(work), *a], check=True, capture_output=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(work)], check=True)
    run("config", "user.email", "t@example.com")
    run("config", "user.name", "T")
    (work / "a.py").write_text("x = 1\n")
    run("add", "-A")
    run("commit", "-q", "-m", "init")
    sha = subprocess.run(
        ["git", "-C", str(work), "rev-parse", "HEAD"], check=True, capture_output=True
    ).stdout.decode().strip()

    bare = tmp_path / "remote.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(work), str(bare)], check=True)
    return f"file://{bare}", sha


def test_clone_returns_workspace_commit_iso(tmp_path, monkeypatch):
    url, sha = _make_bare_repo(tmp_path)
    monkeypatch.setattr(workspace, "normalize_repo", lambda repo: (url, "owner/repo"))
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)

    captured: dict[str, Path] = {}
    with clone_repo("owner/repo") as ws:
        assert ws.commit_sha == sha
        assert ws.commit_iso  # ISO-8601 committer date
        assert (ws.workspace_path / "a.py").exists()
        captured["path"] = ws.workspace_path

    # Tempdir removed after the context exits.
    assert not captured["path"].exists()


def test_clone_at_explicit_sha(tmp_path, monkeypatch):
    url, sha = _make_bare_repo(tmp_path)
    monkeypatch.setattr(workspace, "normalize_repo", lambda repo: (url, "owner/repo"))
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    with clone_repo("owner/repo", ref=sha) as ws:
        assert ws.commit_sha == sha


def test_non_github_host_rejected_before_clone():
    with pytest.raises(CloneError) as exc:
        with clone_repo("https://gitlab.com/owner/repo"):
            pass
    assert exc.value.code == "invalid_repo"


def test_timeout_path_returns_clean_error(monkeypatch):
    def boom(*_a, **_k):
        raise subprocess.TimeoutExpired(cmd="git", timeout=60)

    monkeypatch.setattr(subprocess, "run", boom)
    with pytest.raises(CloneError) as exc:
        workspace._run_git(["clone", "x"], token=None, timeout=60)
    assert exc.value.code == "clone_timeout"


def test_token_scrubbed_from_errors(monkeypatch):
    token = "ghp_supersecret"

    class P:
        returncode = 128
        stderr = f"fatal: could not read from https://x-access-token:{token}@github.com/x".encode()

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: P())
    with pytest.raises(CloneError) as exc:
        workspace._run_git(["clone", "x"], token=token, timeout=60)
    assert token not in str(exc.value)
    assert "***" in str(exc.value)


def test_file_count_cap(tmp_path, monkeypatch):
    url, _ = _make_bare_repo(tmp_path)
    monkeypatch.setattr(workspace, "normalize_repo", lambda repo: (url, "owner/repo"))
    monkeypatch.setattr(workspace, "_MAX_FILES", 0)
    with pytest.raises(CloneError) as exc:
        with clone_repo("owner/repo"):
            pass
    assert exc.value.code == "too_many_files"
