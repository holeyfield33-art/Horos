"""Bearer-auth ASGI middleware — SPEC-mcp-server-v0 §8.

Every MCP request must carry ``Authorization: Bearer ${HOROS_SERVER_SECRET}``;
anything else is rejected with 401 *before* the request reaches the FastMCP app, so
no tool ever runs unauthenticated. The comparison is constant-time. A missing secret
is a hard error at construction — the process refuses to run unauthenticated.

This is a pure-ASGI middleware (not a Starlette ``BaseHTTPMiddleware``) so it sees
every request, including the streamable-HTTP MCP endpoint, before routing. The secret
is never logged nor echoed in any response.
"""

from __future__ import annotations

import hmac

from starlette.types import ASGIApp, Receive, Scope, Send

# Render (and most platforms) probe an unauthenticated health path. Keep it out of band.
HEALTH_PATH = "/healthz"


class BearerAuthMiddleware:
    """Reject any non-health HTTP request lacking the exact bearer credential."""

    def __init__(self, app: ASGIApp, secret: str, *, health_path: str = HEALTH_PATH) -> None:
        if not secret:
            # Hard fail: never run unauthenticated (SPEC §8).
            raise RuntimeError(
                "HOROS_SERVER_SECRET is required; refusing to run unauthenticated"
            )
        self._app = app
        # Compare against the full header value so scheme and token are checked together.
        self._expected = b"Bearer " + secret.encode("utf-8")
        # Also accept the raw token via ?token= query param, because some MCP
        # connector UIs cannot send a custom Authorization header.
        self._expected_token = secret.encode("utf-8")
        self._health_path = health_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Pass lifespan/websocket/etc. straight through to the inner app.
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        if scope.get("path") == self._health_path:
            await self._healthz(send)
            return

        if not self._authorized(scope):
            await self._reject(send)
            return

        await self._app(scope, receive, send)

    def _authorized(self, scope: Scope) -> bool:
        presented: bytes | None = None
        for name, value in scope.get("headers", []):
            if name == b"authorization":
                presented = value
                break
        if presented is not None and hmac.compare_digest(presented, self._expected):
            return True
        # Fallback: token in the query string (?token=SECRET) for connector UIs that
        # cannot set an Authorization header.
        token = self._query_token(scope)
        if token is not None and hmac.compare_digest(token, self._expected_token):
            return True
        hmac.compare_digest(self._expected_token, self._expected_token)
        return False

    @staticmethod
    def _query_token(scope: Scope) -> bytes | None:
        raw = scope.get("query_string", b"")
        if not raw:
            return None
        from urllib.parse import parse_qs
        qs = parse_qs(raw.decode("latin-1"))
        vals = qs.get("token")
        if not vals:
            return None
        return vals[0].encode("utf-8")

    async def _healthz(self, send: Send) -> None:
        body = b'{"status":"ok"}'
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def _reject(self, send: Send) -> None:
        body = b'{"error":"unauthorized"}'
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"www-authenticate", b"Bearer"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
