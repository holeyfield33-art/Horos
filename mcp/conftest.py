"""Make the ``horos_mcp`` package importable when running pytest from ``mcp/``."""

import sys
import secrets
from pathlib import Path
import pytest

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_TEST_SEED = secrets.token_hex(32)

@pytest.fixture(autouse=True)
def _isolated_signer(monkeypatch):
    """A private seed per test run; never use the public parity seed in the service."""
    monkeypatch.setenv("HOROS_SIGNING_SEED", _TEST_SEED)
