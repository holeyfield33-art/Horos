"""Section 4 — parity between /public/route and `horos route`.

The graph-fallback path is deterministic: for a fixed graph + task + seed it
reproduces an identical receipt. This test proves two things:

1. EXACT receipt_hash equality against the deterministic route signer. The
   endpoint feeds the graph to mcp/router_runner.mjs, which runs the same
   loadGraphArtifact→selectContext→buildReceipt→verifyReceipt sequence as
   `horos route`, with the fixed deterministic timestamp/task_id. Running that
   signer standalone over the same graph+task+seed yields the same receipt_hash
   the endpoint returns.

2. Core-field + public_key equality against a live `horos route` CLI run with the
   same seed. task_hash, config_hash, graph_artifact_hash and the signer's
   public_key are all timestamp-independent, so they match the CLI exactly.
   (The CLI's full receipt_hash differs only because `horos route` stamps a live
   timestamp/random task_id, which the deterministic endpoint path pins.)

Together these pin the endpoint's output to the CLI's for the same inputs and
seed on every field that does not depend on wall-clock time.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from conftest import TEST_KEY_SEED
from horos_mcp import public
from horos_mcp.public import run_public_route

_REPO_ROOT = Path(__file__).resolve().parents[2]
_GRAPH_FILE = _REPO_ROOT / "test" / "fixtures" / "graph" / "valid-graph.json"
_RUNNER = _REPO_ROOT / "mcp" / "router_runner.mjs"
_CLI = _REPO_ROOT / "dist" / "cli" / "horos.js"
_TASK = "helper util"

_CORE_FIELDS = ("task_hash", "config_hash", "graph_artifact_hash")


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    public._HITS.clear()
    yield
    public._HITS.clear()


def _graph() -> dict:
    return json.loads(_GRAPH_FILE.read_text())


def _core(receipt: dict) -> dict:
    return {
        "task_hash": receipt["task"]["task_hash"],
        "config_hash": receipt["selector"]["config_hash"],
        "graph_artifact_hash": receipt["graph"]["graph_artifact_hash"],
        "public_key": receipt["signature"]["public_key"],
    }


def _run_reference_signer(tmp_path: Path) -> dict:
    """The deterministic route signer standalone — same code the endpoint invokes."""
    req = tmp_path / "req.json"
    req.write_text(json.dumps({"graph_path": str(_GRAPH_FILE), "task": _TASK, "manual_include": []}))
    env = dict(os.environ)
    env["HOROS_KEY_SEED"] = TEST_KEY_SEED
    proc = subprocess.run(["node", str(_RUNNER), str(req)], capture_output=True, env=env, timeout=60)
    assert proc.returncode == 0, proc.stderr.decode()
    return json.loads(proc.stdout.decode())["full_receipt"]


def _run_cli(seed: str) -> dict:
    proc = subprocess.run(
        ["node", str(_CLI), "route", str(_GRAPH_FILE), *_TASK.split(), "--key", seed, "--json"],
        capture_output=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr.decode()
    return json.loads(proc.stdout.decode())["receipt"]


def test_endpoint_graph_hash_equals_deterministic_signer(tmp_path, monkeypatch):
    monkeypatch.setenv("HOROS_KEY_SEED", TEST_KEY_SEED)
    reference = _run_reference_signer(tmp_path)

    result = run_public_route({"task": _TASK, "graph": _graph()})
    receipt = result["receipt"]

    # Exact hash equality — the graph path is deterministic.
    assert receipt["receipt_hash"] == reference["receipt_hash"]
    assert _core(receipt) == _core(reference)


def test_endpoint_core_fields_equal_cli(monkeypatch):
    monkeypatch.setenv("HOROS_KEY_SEED", TEST_KEY_SEED)
    cli_receipt = _run_cli(TEST_KEY_SEED)

    result = run_public_route({"task": _TASK, "graph": _graph()})
    receipt = result["receipt"]

    # Every timestamp-independent field matches `horos route` for the same seed,
    # including the signer's public_key (same seed → same identity).
    assert _core(receipt) == _core(cli_receipt)


def test_endpoint_receipt_verifies_via_ts_verifier(monkeypatch):
    """The receipt the endpoint returns passes the TS verifier against the graph."""
    from horos_mcp.verifier import verify_receipt

    monkeypatch.setenv("HOROS_KEY_SEED", TEST_KEY_SEED)
    result = run_public_route({"task": _TASK, "graph": _graph()})
    outcome = verify_receipt(result["receipt"], _graph(), _TASK)
    assert outcome["pass"] is True
