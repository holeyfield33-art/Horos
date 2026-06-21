"""Make the ``horos_mcp`` package importable when running pytest from ``mcp/``."""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
