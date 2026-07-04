"""
Horos MCP live acceptance runner — ACCEPTANCE.md §3 / §4.

Run:
    export HOROS_MCP_URL=https://horos.onrender.com
    export HOROS_SERVER_SECRET=<your-secret>
    python mcp/run_acceptance.py

Phases covered:
  2 — route_context dogfood on holeyfield33-art/Horos (TS path)
  3 — route_context on pallets/itsdangerous (Python, no horos.json → config_synthesized)
  4 — determinism: repeat phase-3 call, assert same receipt_hash
  6 — verify_receipt PASS  (requires /tmp/its-receipt.json + /tmp/its-graph.json)
  7 — verify_receipt FAIL  (mutated task → field == "task.task_hash")

Phase 5 (generate full receipt + graph) is a separate shell script: generate_its_receipt.sh
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = os.environ.get("HOROS_MCP_URL", "https://horos.onrender.com").rstrip("/") + "/mcp"
SECRET = os.environ.get("HOROS_SERVER_SECRET", "")
HEADERS = {"Authorization": f"Bearer {SECRET}"}

TASK = "verify receipt signature"
HOROS_REPO = "holeyfield33-art/Horos"
ITS_REPO = "pallets/itsdangerous"

ITS_RECEIPT_PATH = Path("/tmp/its-receipt.json")
ITS_GRAPH_PATH = Path("/tmp/its-graph.json")


async def call_tool(name: str, args: dict) -> dict:
    async with streamablehttp_client(URL, headers=HEADERS) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(name, args)
            # FastMCP returns structured content when available, else text
            if result.structuredContent:
                return result.structuredContent
            # fall back: parse text content
            for part in result.content:
                if hasattr(part, "text"):
                    return json.loads(part.text)
            raise RuntimeError(f"Unexpected result shape: {result!r}")


def check(cond: bool, label: str, detail: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))
    if not cond:
        sys.exit(1)


async def main() -> None:
    if not SECRET:
        print("ERROR: HOROS_SERVER_SECRET not set.")
        sys.exit(1)

    print(f"\n=== Phase 2: route_context dogfood (TS path) ===")
    ts = await call_tool("route_context", {"repo": HOROS_REPO, "task": TASK})
    print(f"  raw keys: {list(ts.keys())}")
    check(ts.get("receipt", {}).get("verified") is True, "receipt.verified == true")
    check(ts.get("selection_status") == "complete", f"selection_status == complete (got: {ts.get('selection_status')})")
    check(bool(ts.get("selected_files")), f"selected_files non-empty ({len(ts.get('selected_files', []))} files)")
    ts_hash = ts["receipt"]["receipt_hash"]
    print(f"  receipt_hash: {ts_hash}")
    print(f"  selected: {[f['path'] for f in ts.get('selected_files', [])[:5]]}{'…' if len(ts.get('selected_files', [])) > 5 else ''}")

    print(f"\n=== Phase 3: route_context on {ITS_REPO} (Python, no horos.json) ===")
    its = await call_tool("route_context", {"repo": ITS_REPO, "task": TASK})
    print(f"  raw keys: {list(its.keys())}")
    check(its.get("config_synthesized") is True, "config_synthesized == true")
    its_status = its.get("selection_status")
    print(f"  selection_status: {its_status}")
    check(its.get("receipt", {}).get("verified") is True, "receipt.verified == true")
    its_hash = its["receipt"]["receipt_hash"]
    print(f"  receipt_hash: {its_hash}")
    if its_status == "partial":
        print(f"  suggested_external_modules: {its.get('suggested_external_modules')}")
    elif its_status == "complete":
        print("  NOTE: selection_status=complete (no unlisted third-party imports found)")

    print(f"\n=== Phase 4: Determinism (repeat {ITS_REPO} call) ===")
    its2 = await call_tool("route_context", {"repo": ITS_REPO, "task": TASK})
    its_hash2 = its2["receipt"]["receipt_hash"]
    check(its_hash2 == its_hash, f"receipt_hash stable (got: {its_hash2})")

    print(f"\n=== Phase 6: verify_receipt PASS ===")
    if not ITS_RECEIPT_PATH.exists() or not ITS_GRAPH_PATH.exists():
        print(f"  SKIP — {ITS_RECEIPT_PATH} or {ITS_GRAPH_PATH} not found.")
        print("  Run  bash mcp/generate_its_receipt.sh  first.")
    else:
        receipt_obj = json.loads(ITS_RECEIPT_PATH.read_text())
        graph_obj = json.loads(ITS_GRAPH_PATH.read_text())
        vpass = await call_tool("verify_receipt", {
            "receipt": receipt_obj,
            "graph": graph_obj,
            "task": TASK,
        })
        print(f"  result: {vpass}")
        check(vpass.get("pass") is True, "verify_receipt pass == true")

        print(f"\n=== Phase 7: verify_receipt FAIL (mutated task) ===")
        vfail = await call_tool("verify_receipt", {
            "receipt": receipt_obj,
            "graph": graph_obj,
            "task": "TAMPERED " + TASK,
        })
        print(f"  result: {vfail}")
        check(vfail.get("pass") is False, "verify_receipt pass == false")
        check(vfail.get("field") == "task.task_hash", f"field == task.task_hash (got: {vfail.get('field')})")

    print(f"\n=== All checks passed ===")
    print(f"\nCapture these for ACCEPTANCE.md §5:")
    print(f"  TS receipt_hash:  {ts_hash}")
    print(f"  PY receipt_hash:  {its_hash}")
    print(f"  ITS selection_status: {its_status}")
    if its_status == "partial":
        print(f"  suggested_external_modules: {its.get('suggested_external_modules')}")


if __name__ == "__main__":
    asyncio.run(main())
