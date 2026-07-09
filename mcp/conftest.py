"""Make the ``horos_mcp`` package importable when running pytest from ``mcp/``."""

import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# Fixed, non-zero signing seed for the test harness ONLY. The runner refuses to
# sign without HOROS_KEY_SEED (see mcp/router_runner.mjs); tests that drive the
# real clone→generate→route chain need a deterministic identity. This is a test
# seed — it is never the deployed key and is never committed as a real secret.
TEST_KEY_SEED = "11" * 32
os.environ.setdefault("HOROS_KEY_SEED", TEST_KEY_SEED)
