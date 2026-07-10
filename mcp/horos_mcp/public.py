"""Free, unauthenticated public router endpoint — ``POST /public/route``.

A dead-simple no-auth surface for the GitHub Pages front-end: paste a public
GitHub repo URL (primary) or a context-graph-v0 artifact (fallback) plus a task,
get back the selected files and a signed receipt. It reuses the exact
clone→generate→route path (repo) or the runner directly (graph), converging on
the same deterministic signing step as the authenticated MCP tool.

Being public, this endpoint is hardened independently of the bearer wall:

* max request body size (413 over cap),
* coarse in-memory per-IP rate limit (429 over cap),
* the clone runs TOKENLESS — an anonymous caller can never make the server read
  a private repo on its behalf (``use_token=False``); private repos fail with a
  clear "public repositories only" error.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import deque

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .router import RouteError, route_context, route_graph
from .workspace import CloneError

# The single public, unauthenticated path. Kept in sync with the auth bypass.
PUBLIC_ROUTE_PATH = "/public/route"

# ── CORS ──────────────────────────────────────────────────────────────────────
# Scoped to the GitHub Pages origin that hosts the static UI, and to this
# endpoint only — /mcp and everything else are untouched. Exact-match origin.
ALLOW_ORIGIN = os.environ.get(
    "HOROS_PUBLIC_ALLOW_ORIGIN", "https://holeyfield33-art.github.io"
)


def cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": ALLOW_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
    }


# ── Abuse limits ──────────────────────────────────────────────────────────────
# Cap realistic graphs; anything larger is refused before parsing.
MAX_BODY_BYTES = int(os.environ.get("HOROS_PUBLIC_MAX_BODY_BYTES", str(5 * 1024 * 1024)))
# Coarse per-IP rate limit: RATE_LIMIT requests per RATE_WINDOW_S seconds.
RATE_LIMIT = int(os.environ.get("HOROS_PUBLIC_RATE_LIMIT", "10"))
RATE_WINDOW_S = int(os.environ.get("HOROS_PUBLIC_RATE_WINDOW_S", "300"))

# IP -> deque[timestamps]. In-memory is fine for a coarse, best-effort guard on a
# single-process uvicorn worker; it resets on restart and does not need to be exact.
_HITS: dict[str, deque[float]] = {}


def _client_ip(request: Request) -> str:
    """Best-effort client IP. Render sits behind a proxy, so honor X-Forwarded-For."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    client = request.client
    return client.host if client else "unknown"


def _rate_limited(ip: str, *, now: float | None = None) -> bool:
    """Record a hit for ``ip`` and report whether it exceeds the window budget."""
    now = time.monotonic() if now is None else now
    dq = _HITS.get(ip)
    if dq is None:
        dq = deque()
        _HITS[ip] = dq
    cutoff = now - RATE_WINDOW_S
    while dq and dq[0] < cutoff:
        dq.popleft()
    if len(dq) >= RATE_LIMIT:
        return True
    dq.append(now)
    return False


# ── Validation ────────────────────────────────────────────────────────────────

_GITHUB_URL = re.compile(r"^https://github\.com/[^/\s]+/[^/\s]+")


class PublicError(Exception):
    """A clean client-facing error with an HTTP status and a safe message."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


# CloneError/RouteError codes that mean "the input is too big/slow" → 413.
_CAP_CODES = {"too_many_files", "workspace_too_large"}

# A valid repo/graph that simply matched nothing is NOT an error — it is a 200
# with an empty selection. This note tells a non-technical caller what to do next.
_EMPTY_SELECTION_NOTE = (
    "No files matched this task. Try a more specific task (name a feature, file, "
    "or subsystem), or confirm the repository has source files Horos can analyze "
    "(Python is supported today)."
)


def _shape(
    selection: list,
    exclusions: list,
    unresolved: list,
    receipt: dict,
    *,
    note: str | None = None,
) -> dict:
    out: dict = {
        "summary": {
            "selected_files": [s["path"] for s in selection],
            "excluded_files": [e["path"] for e in exclusions],
            "unresolved_symbols": list(unresolved),
        },
        "receipt": receipt,
    }
    # Only present on the empty-selection path — the happy path stays {summary, receipt}.
    if note:
        out["note"] = note
    return out


def _empty_selection_note(upstream: str | None) -> str:
    """Compose the caller-facing empty-selection note, folding in any server hint."""
    if upstream:
        return f"{_EMPTY_SELECTION_NOTE} ({upstream})"
    return _EMPTY_SELECTION_NOTE


def run_public_route(payload: object) -> dict:
    """Validate the request body and produce the ``{summary, receipt}`` response.

    Raises :class:`PublicError` for any client-facing failure (mapped to a 4xx).
    """
    if not isinstance(payload, dict):
        raise PublicError(400, "request body must be a JSON object")

    task = payload.get("task")
    if not isinstance(task, str) or not task.strip():
        raise PublicError(400, "'task' is required and must be a non-empty string")

    repo_url = payload.get("repo_url")
    graph = payload.get("graph")
    has_repo = isinstance(repo_url, str) and repo_url.strip() != ""
    has_graph = graph is not None
    if has_repo and has_graph:
        raise PublicError(400, "provide exactly one of 'repo_url' or 'graph', not both")
    if not has_repo and not has_graph:
        raise PublicError(400, "provide either 'repo_url' or 'graph'")

    try:
        if has_graph:
            if not isinstance(graph, dict):
                raise PublicError(400, "'graph' must be a JSON object (context-graph-v0)")
            router = route_graph(graph, task)
            selection = router["selection"]
            # Parity with the repo path: an empty selection is a benign 200 + note,
            # never a 422. (route_graph does not raise on empty — it returns cleanly.)
            note = None if selection else _empty_selection_note(None)
            return _shape(
                selection,
                router["exclusions"],
                router["coverage"]["unresolved_symbols"],
                router["full_receipt"],
                note=note,
            )

        # repo_url path — tokenless clone → generate → route.
        if not _GITHUB_URL.match(repo_url.strip()):
            raise PublicError(400, "'repo_url' must be a public https://github.com/owner/name URL")
        ref = payload.get("ref")
        if ref is not None and not isinstance(ref, str):
            raise PublicError(400, "'ref' must be a string")
        resp = route_context(
            repo_url.strip(),
            task,
            ref=ref or None,
            include_artifacts=True,
            use_token=False,  # never clone private repos for anonymous callers
        )
        receipt = resp.get("receipt_document")
        if receipt is None:
            # Graph too large to surface the full receipt — treat as unprocessable.
            raise PublicError(413, resp.get("artifacts_omitted", "result too large to return"))
        unresolved = []
        if resp.get("unresolved_signal"):
            unresolved = resp["unresolved_signal"].get("unresolved_symbols", [])
        selected = resp["selected_files"]
        # Empty selection on a valid repo is a 200 with a note, not a 422. Fold in
        # the server's own selection_note (why nothing matched) when it is present.
        note = _empty_selection_note(resp.get("selection_note")) if not selected else None
        return _shape(selected, resp["exclusions"], unresolved, receipt, note=note)

    except CloneError as exc:
        if exc.code in _CAP_CODES:
            raise PublicError(413, "repository is too large to route") from None
        if exc.code == "clone_timeout":
            raise PublicError(400, "repository took too long to clone; try a smaller repo") from None
        if exc.code == "clone_failed":
            raise PublicError(
                400,
                "could not clone the repository — public repositories only "
                "(private repos are not accessible)",
            ) from None
        raise PublicError(400, exc.detail) from None
    except RouteError as exc:
        # Classify the routing-result failure into something a non-technical caller
        # can act on. These are the ACTUAL codes route_context/route_graph raise —
        # an empty selection is NOT here (it returns 200 with a note, above).
        if exc.code == "graph_generation_failed":
            raise PublicError(
                422,
                "Horos couldn't build a dependency graph for this repository. Its "
                "language may not be supported yet (Python is supported today), or "
                "some source files couldn't be parsed. Try a Python repository, or "
                "check the repo for the reported source error.",
            ) from None
        if exc.code == "config_not_found":
            raise PublicError(
                422,
                "Horos couldn't find a usable configuration for this repository. "
                "Confirm it has analyzable source files (Python is supported today).",
            ) from None
        if exc.code in {"router_failed", "verify_failed"}:
            raise PublicError(
                422,
                "Horos couldn't route this repository into a verified selection: "
                f"{exc.detail}",
            ) from None
        # invalid_input and any future code — still unprocessable, but say what and why.
        raise PublicError(422, f"could not route: {exc.detail}") from None


# ── ASGI handler ──────────────────────────────────────────────────────────────

async def public_route(request: Request) -> Response:
    headers = cors_headers()

    # CORS preflight — answer OPTIONS with the allow-list, no body.
    if request.method == "OPTIONS":
        return Response(status_code=204, headers=headers)

    # Body-size cap (413) — check the declared length before reading anything.
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_BODY_BYTES:
                return JSONResponse({"error": "request body too large"}, status_code=413, headers=headers)
        except ValueError:
            return JSONResponse({"error": "invalid Content-Length"}, status_code=400, headers=headers)

    # Per-IP rate limit (429).
    if _rate_limited(_client_ip(request)):
        return JSONResponse(
            {"error": "rate limit exceeded; please retry in a few minutes"},
            status_code=429,
            headers=headers,
        )

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:  # guards chunked bodies with no Content-Length
        return JSONResponse({"error": "request body too large"}, status_code=413, headers=headers)

    try:
        payload = json.loads(body) if body else None
    except json.JSONDecodeError as exc:
        return JSONResponse({"error": f"invalid JSON: {exc.msg}"}, status_code=400, headers=headers)

    try:
        result = run_public_route(payload)
    except PublicError as exc:
        return JSONResponse({"error": exc.message}, status_code=exc.status, headers=headers)

    return JSONResponse(result, headers=headers)
