"""Horos Python dependency-graph generator.

A second producer for the FROZEN ``context-graph-v0`` artifact consumed by the
Horos TypeScript router. Pure stdlib, static (``ast`` only — never imports,
executes, or probes ``sys.path``), and byte-deterministic: the same commit plus
the same ``horos.json`` yields a byte-identical graph on any machine.

See ``SPEC-python-generator-v0.md`` and ``DECISIONS-py.md`` at the repo root.
"""

GENERATOR_NAME = "@horos/graph-gen-python"
GENERATOR_VERSION = "0.3.0"

__all__ = ["GENERATOR_NAME", "GENERATOR_VERSION"]
