"""verify_receipt helper — drives the TS verifier runner (verify_runner.mjs).

Called by server.py's ``verify_receipt`` tool.  The runner imports dist/verify/
index.js and re-implements nothing; this module just manages the subprocess
lifecycle so router.py stays focused on the clone→generate→route chain.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from .router import RouteError, _DIST, _ROUTER_TIMEOUT_S, _scrub

_VERIFY_RUNNER = os.environ.get(
    "HOROS_VERIFY_RUNNER",
    str(Path(__file__).resolve().parent.parent / "verify_runner.mjs"),
)


def verify_receipt(
    receipt: dict,
    graph: dict,
    task: str,
    manual_include: list[str] | None = None,
) -> dict:
    """Run the TS verifier against inline receipt + graph + task text.

    Returns ``{"pass": True}`` on success or
    ``{"pass": False, "field": str, "detail": str}`` on a verification failure.
    Raises :exc:`RouteError` (code ``"verify_failed"``) on internal runner error.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        req_path = fh.name
        json.dump(
            {
                "receipt": receipt,
                "graph": graph,
                "task": task,
                "manual_include": list(manual_include or []),
            },
            fh,
        )
    try:
        env = dict(os.environ)
        env["HOROS_DIST"] = _DIST
        try:
            proc = subprocess.run(
                ["node", _VERIFY_RUNNER, req_path],
                check=False,
                capture_output=True,
                timeout=_ROUTER_TIMEOUT_S,
                env=env,
            )
        except subprocess.TimeoutExpired:
            raise RouteError("verify_failed", f"verifier exceeded {_ROUTER_TIMEOUT_S}s")
        raw = proc.stdout.decode("utf-8", "replace").strip()
        try:
            result = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            stderr = _scrub(proc.stderr.decode("utf-8", "replace").strip())
            raise RouteError(
                "verify_failed",
                (stderr.splitlines()[-1] if stderr else "no output")[:300],
            )
        if not result.get("ok"):
            raise RouteError(
                "verify_failed",
                _scrub(str(result.get("error", "verifier error")))[:300],
            )
        if result.get("pass"):
            return {"pass": True}
        return {
            "pass": False,
            "field": result.get("field"),
            "detail": result.get("detail"),
        }
    finally:
        try:
            os.unlink(req_path)
        except OSError:
            pass
