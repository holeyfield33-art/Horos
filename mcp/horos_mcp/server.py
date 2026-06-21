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

import os

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from starlette.types import ASGIApp

from .auth import BearerAuthMiddleware
from .router import RouteError, route_context as _route_context
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
    ) -> dict:
        """Clone a repo at a ref, generate its dependency graph, route the minimal
        context for a task via the Horos selector, and return the selected files plus
        a signed receipt.
        """
        try:
            return _route_context(repo, task, ref, config, manual_include)
        except (CloneError, RouteError) as exc:
            # Clean, secret-free tool error (codes per SPEC §5/§6).
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


def main() -> None:
    import uvicorn

    secret = require_secret()
    port = int(os.environ.get("PORT", str(DEFAULT_PORT)))
    mcp = build_mcp(host="0.0.0.0", port=port)
    app = build_app(mcp, secret)
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
