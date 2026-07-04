"""Seam regression for _synthesize_python_config — closes the gap that let
the external_modules bug ship (PR fix/synthesize-config-external-modules).

The bug shipped because tests verified the file was *written* but never fed it
to the real consumer (load_config).  These tests close that seam: each fixture
calls the REAL Python-generator loader on the synthesised config and asserts it
round-trips without raising, matching the invariants callers depend on.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the Python generator importable from the test environment (mirrors the
# path insertion performed by mcp/horos_mcp/router.py at subprocess time).
# __file__ = mcp/tests/test_synthesis.py → parents[2] = repo root.
_GENERATOR = Path(__file__).resolve().parents[2] / "python" / "graph-gen-python"
sys.path.insert(0, str(_GENERATOR))

from graph_gen_python.config import load_config  # noqa: E402

from horos_mcp.router import _synthesize_python_config  # noqa: E402


def test_empty_dir_synthesises_valid_config(tmp_path: Path) -> None:
    """Test A: no source-root candidates → root fallback (''); load_config must not raise.

    After _normalize_root the empty string becomes '.'.
    """
    config_path = _synthesize_python_config(tmp_path)
    cfg = load_config(config_path)
    assert cfg.external_modules == ()
    assert cfg.python_source_roots == (".",)


def test_src_dir_detected(tmp_path: Path) -> None:
    """Test B: src/ present → python_source_roots == ('src',)."""
    (tmp_path / "src").mkdir()
    config_path = _synthesize_python_config(tmp_path)
    cfg = load_config(config_path)
    assert cfg.python_source_roots == ("src",)
    assert cfg.external_modules == ()


def test_lib_and_app_detected(tmp_path: Path) -> None:
    """Test C: lib/ + app/ present (no src/) → both detected in candidate order."""
    (tmp_path / "lib").mkdir()
    (tmp_path / "app").mkdir()
    config_path = _synthesize_python_config(tmp_path)
    cfg = load_config(config_path)
    # Candidate order: ["src", "lib", "app"] — src absent, so lib+app only.
    assert cfg.python_source_roots == ("lib", "app")
    assert cfg.external_modules == ()
