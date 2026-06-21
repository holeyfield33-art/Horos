"""Repo clone + per-request workspace lifecycle — SPEC-mcp-server-v0 §4, §8.

``clone_repo`` is a context manager. It validates the repo against the github.com /
HTTPS allowlist, clones it shallow + blobless into a per-request temp dir at the
requested ref, enforces resource caps, captures the commit SHA and the committer ISO
timestamp (the deterministic ``--generated-at`` input), and removes the temp dir on
exit. Credentials are never accepted from tool input; private access uses the
server's read-only ``GITHUB_TOKEN`` via a server-side URL rewrite, and the token is
scrubbed from any surfaced error.
"""

from __future__ import annotations

import os
import re
import subprocess
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterator
from urllib.parse import urlparse

# Resource caps (SPEC §8, recorded in DECISIONS-mcp.md), env-overridable.
_CLONE_TIMEOUT_S = int(os.environ.get("HOROS_CLONE_TIMEOUT_S", "60"))
_MAX_FILES = int(os.environ.get("HOROS_MAX_FILES", "50000"))
_MAX_BYTES = int(os.environ.get("HOROS_MAX_BYTES", str(500 * 1024 * 1024)))

_SHORTHAND = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
# A git ref/sha we are willing to hand to git. No leading '-' (option injection),
# no whitespace, no '..' traversal trickery.
_SAFE_REF = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]*$")


class CloneError(Exception):
    """A clean, secret-free failure surfaced to the caller as a tool error."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class CloneResult:
    workspace_path: Path
    commit_sha: str
    commit_iso: str
    origin: str  # clean https URL, never carries a token
    slug: str  # owner/repo


def normalize_repo(repo: str) -> tuple[str, str]:
    """Validate + normalize a repo input to ``(clean_https_url, owner/repo)``.

    Accepts ``owner/repo`` shorthand or an ``https://github.com/...`` URL only.
    Rejects other hosts, non-https schemes, and any embedded credentials.
    """
    repo = repo.strip()
    if not repo:
        raise CloneError("invalid_repo", "repo is empty")

    if _SHORTHAND.match(repo):
        owner, name = repo.split("/")
        name = name[:-4] if name.endswith(".git") else name
        return f"https://github.com/{owner}/{name}.git", f"{owner}/{name}"

    parsed = urlparse(repo)
    if parsed.scheme != "https":
        raise CloneError("invalid_repo", "only https github.com URLs are allowed")
    if parsed.username or parsed.password or "@" in parsed.netloc:
        raise CloneError("invalid_repo", "credentials must not be supplied in the repo URL")
    if parsed.hostname != "github.com":
        raise CloneError("invalid_repo", "only github.com is allowed")

    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        raise CloneError("invalid_repo", "expected github.com/<owner>/<repo>")
    owner, name = parts[0], parts[1]
    name = name[:-4] if name.endswith(".git") else name
    return f"https://github.com/{owner}/{name}.git", f"{owner}/{name}"


def _validate_ref(ref: str) -> None:
    if not _SAFE_REF.match(ref):
        raise CloneError("invalid_ref", "ref contains disallowed characters")


def _authed_url(clean_url: str, token: str | None) -> str:
    """Inject the read-only token into a github.com URL for cloning only."""
    if not token:
        return clean_url
    return clean_url.replace(
        "https://github.com/", f"https://x-access-token:{token}@github.com/", 1
    )


def _scrub(text: str, token: str | None) -> str:
    return text.replace(token, "***") if token else text


def _run_git(args: list[str], *, token: str | None, timeout: int) -> subprocess.CompletedProcess:
    """Run a git command with a hard timeout; map failures to clean CloneErrors.

    ``--recurse-submodules`` is never passed, so submodules are never expanded.
    """
    try:
        proc = subprocess.run(
            ["git", *args],
            check=False,
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise CloneError("clone_timeout", f"git exceeded {timeout}s")
    except OSError as exc:  # git missing, etc.
        raise CloneError("clone_failed", f"could not run git: {exc.strerror or exc}")
    if proc.returncode != 0:
        stderr = _scrub(proc.stderr.decode("utf-8", "replace").strip(), token)
        # Keep it short and secret-free.
        summary = stderr.splitlines()[-1] if stderr else f"exit {proc.returncode}"
        raise CloneError("clone_failed", summary[:300])
    return proc


def _clone_into(url: str, ref: str | None, dest: Path, *, token: str | None) -> None:
    """Shallow + blobless clone at ``ref``; SHA-not-at-tip falls back to fetch."""
    base = ["clone", "--depth", "1", "--filter=blob:none", "--no-recurse-submodules"]
    if ref is None:
        _run_git([*base, url, str(dest)], token=token, timeout=_CLONE_TIMEOUT_S)
        return

    _validate_ref(ref)
    # Branch or tag: a --branch clone is the fast path.
    try:
        _run_git(
            [*base, "--branch", ref, url, str(dest)],
            token=token,
            timeout=_CLONE_TIMEOUT_S,
        )
        return
    except CloneError as exc:
        if exc.code == "clone_timeout":
            raise
    # Explicit SHA not at a tip: init + fetch the commit + checkout FETCH_HEAD.
    dest.mkdir(parents=True, exist_ok=True)
    _run_git(["init", "-q", str(dest)], token=token, timeout=_CLONE_TIMEOUT_S)
    _run_git(
        ["-C", str(dest), "fetch", "--depth", "1", "--filter=blob:none", url, ref],
        token=token,
        timeout=_CLONE_TIMEOUT_S,
    )
    _run_git(
        ["-C", str(dest), "checkout", "-q", "FETCH_HEAD"],
        token=token,
        timeout=_CLONE_TIMEOUT_S,
    )


def _enforce_caps(dest: Path) -> None:
    """Reject workspaces that exceed the file-count / size caps (SPEC §8)."""
    files = 0
    total = 0
    for root, dirs, names in os.walk(dest):
        if ".git" in dirs:
            dirs.remove(".git")  # ignore git internals for the content caps
        for name in names:
            files += 1
            if files > _MAX_FILES:
                raise CloneError("too_many_files", f"more than {_MAX_FILES} files")
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                continue
            if total > _MAX_BYTES:
                raise CloneError("workspace_too_large", f"larger than {_MAX_BYTES} bytes")


def _capture(args: list[str], dest: Path) -> str:
    proc = subprocess.run(
        ["git", "-C", str(dest), *args],
        check=False,
        capture_output=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise CloneError("clone_failed", "could not read commit metadata")
    return proc.stdout.decode("utf-8", "replace").strip()


@contextmanager
def clone_repo(repo: str, ref: str | None = None) -> Iterator[CloneResult]:
    """Clone ``repo`` at ``ref`` into a temp workspace; clean it up on exit."""
    clean_url, slug = normalize_repo(repo)
    token = os.environ.get("GITHUB_TOKEN") or None
    url = _authed_url(clean_url, token)

    # TemporaryDirectory removes the workspace on exit, including on any error.
    with TemporaryDirectory(prefix="horos-") as tmp:
        dest = Path(tmp) / "repo"
        _clone_into(url, ref, dest, token=token)
        _enforce_caps(dest)
        commit_sha = _capture(["rev-parse", "HEAD"], dest)
        commit_iso = _capture(["log", "-1", "--format=%cI"], dest)
        yield CloneResult(
            workspace_path=dest,
            commit_sha=commit_sha,
            commit_iso=commit_iso,
            origin=clean_url,
            slug=slug,
        )
