"""FastMCP server entrypoint — SPEC-mcp-server-v0 §1, §8.

Boots the ``Horos`` MCP server over streamable-HTTP, behind bearer auth, exposing a
single tool: ``route_context``. In M0 the tool returns a hardcoded shape; M2 wires it
to the real clone→generate→route chain.

SDK note (verified against ``mcp==1.28.0``, recorded in DECISIONS-mcp.md): the spec
§8 snippet ``mcp.run(transport="streamable-http", host=..., port=...)`` does not match
this SDK — ``FastMCP.run(transport, mount_path)`` takes no host/port. Host/port belong
on the ``FastMCP(...)`` constructor, and the bearer middleware must wrap the Starlette
app returned by ``streamable_http_app()`` so auth runs before tool dispatch. We
therefore serve that wrapped app with uvicorn rather than calling ``mcp.run()``.
"""

from __future__ import annotations

import logging
import os
import re

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from starlette.types import ASGIApp

from .auth import BearerAuthMiddleware
from .router import RouteError, route_context as _route_context
from .verifier import verify_receipt as _verify_receipt
from .workspace import CloneError

SERVER_NAME = "Horos"
DEFAULT_PORT = 8000


def register_tools(mcp: FastMCP) -> None:
    """Attach the tool surface (SPEC §3)."""

    @mcp.tool()
    def route_context(
        repo: str,
        task: str,
        ref: str | None = None,
        config: str = "horos.json",
        manual_include: list[str] | None = None,
        include_artifacts: bool = False,
    ) -> dict:
        """Clone a repo at a ref, generate its dependency graph, route the minimal
        context for a task via the Horos selector, and return the selected files plus
        a signed receipt.

        When ``include_artifacts`` is True the response also carries
        ``receipt_document`` (the full signed Receipt object) and ``graph_document``
        (the full graph artifact JSON), enabling a direct ``verify_receipt``
        round-trip without any additional cloning.  If the serialised graph exceeds
        HOROS_MAX_ARTIFACT_BYTES (default 2 MB) both documents are omitted and
        ``artifacts_omitted`` is set instead — the call never fails over size.

        When selection is empty, ``selection_note`` provides actionable guidance
        built from real graph signals (partial completeness, unresolved modules,
        synthesised config) rather than a canned string.
        """
        try:
            return _route_context(repo, task, ref, config, manual_include, include_artifacts)
        except (CloneError, RouteError) as exc:
            # Log server-side with full context; surface only the clean code+detail to the client.
            logging.getLogger(__name__).warning(
                "route_context error code=%s detail=%s", exc.code, exc.detail
            )
            raise ToolError(f"{exc.code}: {exc.detail}") from None

    @mcp.tool()
    def verify_receipt(
        receipt: dict,
        graph: dict,
        task: str,
        manual_include: list[str] | None = None,
    ) -> dict:
        """Verify a Horos receipt against its graph artifact and task text.

        Accepts inline JSON objects — no repository clone required.  Returns
        ``{"pass": true}`` on success or ``{"pass": false, "field": "...",
        "detail": "..."}`` identifying the exact diverging field.  This is the
        tool third-party auditors use to confirm that a receipt is authentic
        without needing access to the original repository.
        """
        try:
            return _verify_receipt(receipt, graph, task, manual_include)
        except RouteError as exc:
            logging.getLogger(__name__).warning(
                "verify_receipt error code=%s detail=%s", exc.code, exc.detail
            )
            raise ToolError(f"{exc.code}: {exc.detail}") from None


def build_mcp(host: str = "0.0.0.0", port: int = DEFAULT_PORT) -> FastMCP:
    """Construct the FastMCP server with tools registered (no transport started)."""
    mcp = FastMCP(SERVER_NAME, host=host, port=port)
    register_tools(mcp)
    return mcp


def build_app(mcp: FastMCP, secret: str) -> ASGIApp:
    """Wrap the streamable-HTTP Starlette app with bearer auth (SPEC §8)."""
    return BearerAuthMiddleware(mcp.streamable_http_app(), secret)


def require_secret() -> str:
    """Read the bearer secret from the env; missing => hard fail (SPEC §8)."""
    secret = os.environ.get("HOROS_SERVER_SECRET")
    if not secret:
        raise RuntimeError(
            "HOROS_SERVER_SECRET is required; refusing to start unauthenticated"
        )
    return secret


_HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")


def require_key_seed() -> str:
    """Read the Ed25519 signing seed from the env; missing/malformed => hard fail.

    Mirrors the HOROS_SERVER_SECRET posture: the server refuses to start without
    a real signing identity, so no receipt is ever signed with a forgeable
    default key. The router runner subprocess inherits this via ``os.environ``.
    """
    seed = os.environ.get("HOROS_KEY_SEED")
    if not seed:
        raise RuntimeError(
            "HOROS_KEY_SEED is required; refusing to start without a signing identity"
        )
    if not _HEX64.match(seed):
        raise RuntimeError(
            "HOROS_KEY_SEED must be exactly 64 hex characters (32 bytes)"
        )
    return seed


def main() -> None:
    import uvicorn

    secret = require_secret()
    require_key_seed()  # hard-fail before binding if no signing identity is set
    port = int(os.environ.get("PORT", str(DEFAULT_PORT)))
    mcp = build_mcp(host="0.0.0.0", port=port)
    app = build_app(mcp, secret)
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
