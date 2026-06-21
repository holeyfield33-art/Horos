"""Horos MCP server — a thin orchestrator that WRAPS the verified Python graph
generator (``python/graph-gen-python``) and the frozen TS router (``dist/``).

It changes nothing in the router, receipt schema, canonical layer, verify CLI, the
TS generator, or the Python generator. It only clones a committed repo, shells out
to the proven generate→route invocations, and shapes the response. Source of truth:
``SPEC-mcp-server-v0.md`` + the v0.4 build directives.

The importable package is ``horos_mcp`` (not ``mcp``) so it never shadows the
installed ``mcp`` SDK package.
"""

__all__ = ["__version__"]

__version__ = "0.4.0"
