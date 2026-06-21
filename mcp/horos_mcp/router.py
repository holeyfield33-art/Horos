"""route_context full chain — SPEC-mcp-server-v0 §3, §5, §6.

Clone → generate the graph in-request (Python generator subprocess) → route it
through the unchanged TS router (node runner over dist/) → shape the §3 response.
The server shells out to the proven invocations and re-implements neither stage.

The load-bearing invariant (directive "the one thing that must hold"): the router
step mirrors the P5 parity sequence and the receipt MUST verify. A graph that is
`partial` is never returned as `complete`; a receipt that does not verify is an
error, never a result. Secrets (GITHUB_TOKEN) never appear in any surfaced error.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .workspace import CloneError, clone_repo

# Layout (overridable for the container image; see DECISIONS-mcp.md / Dockerfile).
_REPO_ROOT = Path(__file__).resolve().parents[2]
_DIST = os.environ.get("HOROS_DIST", str(_REPO_ROOT / "dist"))
_GENERATOR_PATH = os.environ.get(
    "HOROS_GENERATOR_PATH", str(_REPO_ROOT / "python" / "graph-gen-python")
)
_ROUTER_RUNNER = os.environ.get(
    "HOROS_ROUTER_RUNNER", str(_REPO_ROOT / "mcp" / "router_runner.mjs")
)

_GEN_TIMEOUT_S = int(os.environ.get("HOROS_GEN_TIMEOUT_S", "120"))
_ROUTER_TIMEOUT_S = int(os.environ.get("HOROS_ROUTER_TIMEOUT_S", "120"))

_PARTIAL_WARNING = (
    "Selection may be incomplete: unresolved dependencies were found. Files "
    "reachable only through these may be missing from the selection."
)


class RouteError(Exception):
    """A clean, secret-free tool error (graph_generation_failed / router_failed / ...)."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def _scrub(text: str) -> str:
    token = os.environ.get("GITHUB_TOKEN")
    return text.replace(token, "***") if token else text


def _resolve_config(workspace: Path, config: str) -> Path:
    """Resolve a repo-relative config path, refusing to escape the workspace."""
    candidate = (workspace / config).resolve()
    try:
        candidate.relative_to(workspace.resolve())
    except ValueError:
        raise RouteError("config_not_found", "config path escapes the repository")
    if not candidate.is_file():
        raise RouteError("config_not_found", f"{config} not found in the repository")
    return candidate


def _generate_graph(
    workspace: Path, config_path: Path, out_path: Path, *, origin: str, sha: str, iso: str
) -> None:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = _GENERATOR_PATH + (os.pathsep + existing if existing else "")
    cmd = [
        sys.executable,
        "-m",
        "graph_gen_python",
        "--repo",
        str(workspace),
        "--config",
        str(config_path),
        "--out",
        str(out_path),
        "--generated-at",
        iso,
        "--repository-origin",
        origin,  # clean origin only — never the token-bearing clone URL
        "--commit-sha",
        sha,
    ]
    try:
        proc = subprocess.run(
            cmd, check=False, capture_output=True, timeout=_GEN_TIMEOUT_S, env=env
        )
    except subprocess.TimeoutExpired:
        raise RouteError("graph_generation_failed", f"generator exceeded {_GEN_TIMEOUT_S}s")
    if proc.returncode != 0:
        stderr = _scrub(proc.stderr.decode("utf-8", "replace").strip())
        summary = stderr.splitlines()[-1] if stderr else f"exit {proc.returncode}"
        raise RouteError("graph_generation_failed", summary[:300])


def _module_not_found(artifact: dict) -> list[str]:
    """Distinct top-level module_not_found specifiers — the generator's report source."""
    names = {
        str(e.get("raw_specifier", "")).split(".", 1)[0]
        for e in artifact.get("edges", [])
        if e.get("resolution_error") == "module_not_found" and e.get("raw_specifier")
    }
    return sorted(n for n in names if n)


def _run_router(graph_path: Path, task: str, manual_include: list[str]) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        req_path = fh.name
        json.dump(
            {"graph_path": str(graph_path), "task": task, "manual_include": manual_include},
            fh,
        )
    try:
        env = dict(os.environ)
        env["HOROS_DIST"] = _DIST
        try:
            proc = subprocess.run(
                ["node", _ROUTER_RUNNER, req_path],
                check=False,
                capture_output=True,
                timeout=_ROUTER_TIMEOUT_S,
                env=env,
            )
        except subprocess.TimeoutExpired:
            raise RouteError("router_failed", f"router exceeded {_ROUTER_TIMEOUT_S}s")
        out = proc.stdout.decode("utf-8", "replace").strip()
        try:
            result = json.loads(out) if out else {}
        except json.JSONDecodeError:
            stderr = _scrub(proc.stderr.decode("utf-8", "replace").strip())
            raise RouteError("router_failed", (stderr.splitlines()[-1] if stderr else "no output")[:300])
        if not result.get("ok"):
            raise RouteError("router_failed", _scrub(str(result.get("detail") or result.get("field") or "router error"))[:300])
        if not result.get("verified"):
            # The load-bearing invariant: never return an unverified receipt.
            raise RouteError("router_failed", "receipt did not verify")
        return result
    finally:
        try:
            os.unlink(req_path)
        except OSError:
            pass


def _shape_response(commit_sha: str, router: dict, mnf: list[str]) -> dict:
    # selection_status is driven by module_not_found (genuinely unlisted deps), not the
    # generator's raw `completeness` flag — which is `partial` for any external/stdlib
    # boundary even when every dep is listed. Listed externals/stdlib => complete;
    # an unlisted third-party import => partial. (DECISIONS-mcp.md.)
    partial = bool(mnf)
    receipt = router["receipt"]
    response: dict = {
        "repo_commit": commit_sha,
        "selection_status": "partial" if partial else "complete",
        "selected_files": router["selection"],
        "exclusions": [
            {"path": e["path"], "reason": e["reason_code"]} for e in router["exclusions"]
        ],
        "unresolved_signal": None,
        "suggested_external_modules": [],
        "receipt": {
            "receipt_hash": receipt["receipt_hash"],
            "verified": True,
            "task_hash": receipt["task_hash"],
            "config_hash": receipt["config_hash"],
            "graph_artifact_hash": receipt["graph_artifact_hash"],
        },
    }
    if partial:
        response["unresolved_signal"] = {
            "warning": _PARTIAL_WARNING,
            "unresolved_symbols": list(router["coverage"]["unresolved_symbols"]),
            "module_not_found": mnf,
        }
        response["suggested_external_modules"] = mnf
    return response


def route_context(
    repo: str,
    task: str,
    ref: str | None = None,
    config: str = "horos.json",
    manual_include: list[str] | None = None,
) -> dict:
    """Run the full clone→generate→route chain and return the §3 response.

    Raises RouteError / CloneError on any clean failure (mapped to a tool error).
    """
    manual_include = list(manual_include or [])
    with clone_repo(repo, ref) as ws:
        config_path = _resolve_config(ws.workspace_path, config)
        with tempfile.TemporaryDirectory(prefix="horos-graph-") as gtmp:
            graph_path = Path(gtmp) / "graph.json"
            _generate_graph(
                ws.workspace_path,
                config_path,
                graph_path,
                origin=ws.origin,
                sha=ws.commit_sha,
                iso=ws.commit_iso,
            )
            artifact = json.loads(graph_path.read_text(encoding="utf-8"))
            mnf = _module_not_found(artifact)
            router = _run_router(graph_path, task, manual_include)
            return _shape_response(ws.commit_sha, router, mnf)
