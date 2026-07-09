"""Section 0 — the signing seed is real, never the forgeable all-zeros default.

Before this change ``router_runner.mjs`` hardcoded ``SEED = "00".repeat(32)`` so
every signed receipt was forgeable. These tests prove:

* with ``HOROS_KEY_SEED`` set, the runner signs with the key DERIVED from that
  seed (public_key matches), and the all-zeros public key never appears;
* an unset or malformed seed makes the runner refuse to sign (exit 1);
* the server startup check ``require_key_seed`` hard-fails the same way.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from conftest import TEST_KEY_SEED

_REPO_ROOT = Path(__file__).resolve().parents[2]
_RUNNER = _REPO_ROOT / "mcp" / "router_runner.mjs"
_GRAPH = _REPO_ROOT / "test" / "fixtures" / "graph" / "valid-graph.json"

# Public keys derived (via dist/canonical) from the two seeds — see KEY-MANAGEMENT.md.
TEST_SEED_PUBLIC_KEY = "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737"
ZERO_SEED_PUBLIC_KEY = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29"


def _run_runner(tmp_path: Path, env_overrides: dict | None) -> subprocess.CompletedProcess:
    req = tmp_path / "req.json"
    req.write_text(json.dumps({"graph_path": str(_GRAPH), "task": "helper util", "manual_include": []}))
    import os

    env = dict(os.environ)
    env.pop("HOROS_KEY_SEED", None)
    if env_overrides:
        env.update(env_overrides)
    return subprocess.run(
        ["node", str(_RUNNER), str(req)],
        capture_output=True,
        env=env,
        timeout=60,
    )


def test_runner_signs_with_derived_key_not_zeros(tmp_path):
    proc = _run_runner(tmp_path, {"HOROS_KEY_SEED": TEST_KEY_SEED})
    assert proc.returncode == 0, proc.stderr.decode()
    out = json.loads(proc.stdout.decode())
    assert out["ok"] is True
    pub = out["full_receipt"]["signature"]["public_key"]
    # The signer identity is the key derived from the test seed …
    assert pub == TEST_SEED_PUBLIC_KEY
    # … and the forgeable all-zeros key never appears anywhere in the output.
    assert ZERO_SEED_PUBLIC_KEY not in proc.stdout.decode()


def test_runner_refuses_unset_seed(tmp_path):
    proc = _run_runner(tmp_path, None)  # HOROS_KEY_SEED stripped from env
    assert proc.returncode == 1
    out = json.loads(proc.stdout.decode())
    assert out["ok"] is False
    assert out["error"] == "signing_key_unset"
    assert out["field"] == "HOROS_KEY_SEED"


def test_runner_refuses_malformed_seed(tmp_path):
    proc = _run_runner(tmp_path, {"HOROS_KEY_SEED": "not-64-hex"})
    assert proc.returncode == 1
    out = json.loads(proc.stdout.decode())
    assert out["ok"] is False
    assert out["error"] == "signing_key_invalid"


def test_server_require_key_seed_hard_fails(monkeypatch):
    from horos_mcp.server import require_key_seed

    monkeypatch.delenv("HOROS_KEY_SEED", raising=False)
    with pytest.raises(RuntimeError, match="HOROS_KEY_SEED is required"):
        require_key_seed()

    monkeypatch.setenv("HOROS_KEY_SEED", "tooshort")
    with pytest.raises(RuntimeError, match="64 hex"):
        require_key_seed()

    monkeypatch.setenv("HOROS_KEY_SEED", TEST_KEY_SEED)
    assert require_key_seed() == TEST_KEY_SEED
