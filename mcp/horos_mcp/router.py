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
import logging
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
_GENERATOR_RUNNER = os.environ.get(
    "HOROS_GENERATOR_RUNNER", str(_REPO_ROOT / "mcp" / "generate_runner.mjs")
)

# Graph size guard for include_artifacts (bytes of compact JSON).
_MAX_ARTIFACT_BYTES = int(os.environ.get("HOROS_MAX_ARTIFACT_BYTES", "2000000"))

_log = logging.getLogger(__name__)


def _gen_timeout() -> int:
    """Return the generator timeout, reading from env at call time for live tuning.

    Falls back to 120 s if the env var is absent or not a valid integer.
    """
    raw = os.environ.get("HOROS_GEN_TIMEOUT_S", "120")
    try:
        return int(raw)
    except ValueError:
        return 120


def _router_timeout() -> int:
    """Return the router/verifier timeout, reading from env at call time for live tuning.

    Falls back to 120 s if the env var is absent or not a valid integer.
    """
    raw = os.environ.get("HOROS_ROUTER_TIMEOUT_S", "120")
    try:
        return int(raw)
    except ValueError:
        return 120

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


def _detect_language(workspace: Path) -> str:
    """Return ``"typescript"`` or ``"python"`` based on marker files.

    ``horos.json`` is an explicit Python-pipeline signal and wins over
    ``tsconfig.json`` so mixed repos (TS project that also ships a horos.json)
    keep their explicit configuration.
    """
    if (workspace / "horos.json").exists():
        return "python"
    if (workspace / "tsconfig.json").exists():
        return "typescript"
    return "python"  # will trigger config synthesis


def _synthesize_python_config(workspace: Path) -> Path:
    """Write a minimal horos.json into the workspace and return its path.

    Probes for common Python source-root directories; falls back to the repo
    root (``""``).  Writing directly to the workspace is safe because the
    workspace lives in an ephemeral temp directory from clone_repo.
    """
    candidates = ["src", "lib", "app"]
    source_roots = [d for d in candidates if (workspace / d).is_dir()] or [""]
    config_path = workspace / "horos.json"
    config_path.write_text(
        json.dumps({"python_source_roots": source_roots, "external_modules": []}),
        encoding="utf-8",
    )
    return config_path


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
    """Run the Python generator subprocess."""
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
    t = _gen_timeout()  # capture once so timeout and error message always agree
    try:
        proc = subprocess.run(
            cmd, check=False, capture_output=True, timeout=t, env=env
        )
    except subprocess.TimeoutExpired:
        raise RouteError("graph_generation_failed", f"generator exceeded {t}s")
    if proc.returncode != 0:
        stderr = _scrub(proc.stderr.decode("utf-8", "replace").strip())
        summary = stderr.splitlines()[-1] if stderr else f"exit {proc.returncode}"
        raise RouteError("graph_generation_failed", summary[:300])


def _generate_graph_ts(
    workspace: Path, tsconfig_path: Path, out_path: Path, *, origin: str, sha: str, iso: str
) -> None:
    """Run the TypeScript generator via the Node.js generate_runner.mjs."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        req_path = fh.name
        json.dump(
            {
                "tsconfig": str(tsconfig_path),
                "repo": str(workspace),
                "origin": origin,
                "commit": sha,
                "generated_at": iso,
                "out": str(out_path),
            },
            fh,
        )
    try:
        env = dict(os.environ)
        env["HOROS_DIST"] = _DIST
        t = _gen_timeout()  # capture once so timeout and error message always agree
        try:
            proc = subprocess.run(
                ["node", _GENERATOR_RUNNER, req_path],
                check=False,
                capture_output=True,
                timeout=t,
                env=env,
            )
        except subprocess.TimeoutExpired:
            raise RouteError("graph_generation_failed", f"generator exceeded {t}s")
        out = proc.stdout.decode("utf-8", "replace").strip()
        try:
            result = json.loads(out) if out else {}
        except json.JSONDecodeError:
            stderr = _scrub(proc.stderr.decode("utf-8", "replace").strip())
            raise RouteError(
                "graph_generation_failed",
                (stderr.splitlines()[-1] if stderr else f"exit {proc.returncode}")[:300],
            )
        if not result.get("ok"):
            raise RouteError(
                "graph_generation_failed",
                _scrub(str(result.get("error", "generator error")))[:300],
            )
    finally:
        try:
            os.unlink(req_path)
        except OSError:
            pass


def _build_selection_note(
    mnf: list[str],
    artifact: dict | None,
    config_synthesized: bool,
) -> str:
    """Build a human-readable note when the selection is empty."""
    parts = ["no entrypoints matched the task"]
    if artifact:
        completeness = artifact.get("metadata", {}).get("completeness", "")
        if completeness == "partial":
            n = artifact.get("metadata", {}).get("coverage", {}).get("unresolved_edges", 0)
            parts.append(
                f"graph is partial ({n} unresolved edge{'s' if n != 1 else ''})"
            )
    if mnf:
        parts.append(f"add these to external_modules and retry: {mnf!r}")
    if config_synthesized:
        parts.append(
            "a default config was used; committing a horos.json may improve coverage"
        )
    return "; ".join(parts)


def _attach_artifacts(response: dict, artifact: dict, router: dict) -> None:
    """Attach receipt_document + graph_document to *response* (include_artifacts=True).

    Subject to HOROS_MAX_ARTIFACT_BYTES size guard.  Never fails the call — if
    the graph is too large both documents are omitted and ``artifacts_omitted``
    is set instead.
    """
    graph_bytes = json.dumps(artifact, separators=(",", ":")).encode()
    if len(graph_bytes) > _MAX_ARTIFACT_BYTES:
        response["artifacts_omitted"] = (
            f"graph_document is {len(graph_bytes)} bytes, "
            f"exceeds HOROS_MAX_ARTIFACT_BYTES ({_MAX_ARTIFACT_BYTES})"
        )
        return
    full_receipt = router.get("full_receipt")
    if full_receipt is None:
        # Runner didn't expose full_receipt (e.g. older or overridden runner).
        # Treat as an omission rather than silently setting receipt_document=None,
        # which would silently break verify_receipt composition.
        response["artifacts_omitted"] = "full_receipt unavailable from router runner"
        return
    response["receipt_document"] = full_receipt
    response["graph_document"] = artifact


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
        t = _router_timeout()  # capture once so timeout and error message always agree
        try:
            proc = subprocess.run(
                ["node", _ROUTER_RUNNER, req_path],
                check=False,
                capture_output=True,
                timeout=t,
                env=env,
            )
        except subprocess.TimeoutExpired:
            raise RouteError("router_failed", f"router exceeded {t}s")
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


def _shape_response(
    commit_sha: str,
    router: dict,
    mnf: list[str],
    *,
    artifact: dict | None = None,
    config_synthesized: bool = False,
) -> dict:
    # selection_status is driven by module_not_found (genuinely unlisted deps), not the
    # generator's raw `completeness` flag — which is `partial` for any external/stdlib
    # boundary even when every dep is listed. Listed externals/stdlib => complete;
    # an unlisted third-party import => partial. (DECISIONS-mcp.md.)
    partial = bool(mnf)
    receipt = router["receipt"]
    selection = router["selection"]
    response: dict = {
        "repo_commit": commit_sha,
        "selection_status": "partial" if partial else "complete",
        "selected_files": selection,
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
    if config_synthesized:
        response["config_synthesized"] = True
    if not selection:
        response["selection_note"] = _build_selection_note(mnf, artifact, config_synthesized)
    return response


def route_context(
    repo: str,
    task: str,
    ref: str | None = None,
    config: str = "horos.json",
    manual_include: list[str] | None = None,
    include_artifacts: bool = False,
) -> dict:
    """Run the full clone→generate→route chain and return the §3 response.

    When ``include_artifacts`` is ``True`` the response also carries
    ``receipt_document`` (the full signed Receipt) and ``graph_document`` (the
    full graph artifact), enabling a direct ``verify_receipt`` round-trip.  If
    the serialised graph exceeds ``HOROS_MAX_ARTIFACT_BYTES`` both documents are
    omitted and ``artifacts_omitted`` is set instead.  The call never fails over
    artifact size.

    Raises RouteError / CloneError on any clean failure (mapped to a tool error).
    """
    manual_include = list(manual_include or [])
    # Validate each path: relative, no traversal, reasonable length.
    for _p in manual_include:
        if len(_p) > 1024:
            raise RouteError("invalid_input", f"manual_include path exceeds 1024 chars")
        if _p.startswith("/"):
            raise RouteError("invalid_input", f"manual_include path must be relative, not absolute")
        if ".." in Path(_p).parts:
            raise RouteError("invalid_input", f"manual_include path must not contain '..'")
    with clone_repo(repo, ref) as ws:
        language = _detect_language(ws.workspace_path)
        config_synthesized = False
        if language == "typescript":
            tsconfig_path = ws.workspace_path / "tsconfig.json"
            with tempfile.TemporaryDirectory(prefix="horos-graph-") as gtmp:
                graph_path = Path(gtmp) / "graph.json"
                _generate_graph_ts(
                    ws.workspace_path,
                    tsconfig_path,
                    graph_path,
                    origin=ws.origin,
                    sha=ws.commit_sha,
                    iso=ws.commit_iso,
                )
                artifact = json.loads(graph_path.read_text(encoding="utf-8"))
                mnf = _module_not_found(artifact)
                router = _run_router(graph_path, task, manual_include)
                response = _shape_response(ws.commit_sha, router, mnf, artifact=artifact)
                if include_artifacts:
                    _attach_artifacts(response, artifact, router)
                return response
        else:
            if not (ws.workspace_path / "horos.json").exists():
                _synthesize_python_config(ws.workspace_path)
                config_synthesized = True
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
                response = _shape_response(
                    ws.commit_sha, router, mnf,
                    artifact=artifact,
                    config_synthesized=config_synthesized,
                )
                if include_artifacts:
                    _attach_artifacts(response, artifact, router)
                return response
