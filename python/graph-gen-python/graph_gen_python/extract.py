"""Import extraction + edge emission — SPEC §3, build PR P3.

Walks a file's AST for every ``import`` / ``from ... import`` (control flow
ignored — conditional and function-local imports are parsed too) plus
``importlib.import_module(...)`` and ``__import__(...)`` calls. Each construct is
turned into a graph edge per the SPEC §3 table.

INVARIANT (SPEC §1 decision 3, build PR P3): an import the parser saw but could
not resolve to a file is ALWAYS a first-class unresolved edge — never dropped.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass

from .resolver import (
    ModuleIndex,
    absolutize_relative,
    classify_external,
)


@dataclass
class Edge:
    source: str
    target: str | None
    type: str
    resolved: bool
    line: int
    raw_specifier: str | None = None
    resolution_error: str | None = None

    def to_dict(self) -> dict[str, object]:
        if self.resolved:
            return {
                "source": self.source,
                "target": self.target,
                "type": self.type,
                "resolved": True,
                "line": self.line,
            }
        return {
            "source": self.source,
            "target": None,
            "type": self.type,
            "resolved": False,
            "raw_specifier": self.raw_specifier,
            "resolution_error": self.resolution_error,
            "line": self.line,
        }


def _is_dynamic_import_call(node: ast.Call) -> bool:
    func = node.func
    if isinstance(func, ast.Name) and func.id == "__import__":
        return True
    if (
        isinstance(func, ast.Attribute)
        and func.attr == "import_module"
        and isinstance(func.value, ast.Name)
        and func.value.id == "importlib"
    ):
        return True
    return False


class EdgeBuilder:
    def __init__(
        self,
        index: ModuleIndex,
        external_modules: tuple[str, ...],
    ) -> None:
        self._index = index
        self._external = external_modules

    def edges_for_file(self, source_key: str, tree: ast.Module) -> list[Edge]:
        edges: list[Edge] = []
        importer_package = self._index.package_of(source_key)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    edges.append(
                        self._static_edge(source_key, alias.name, node.lineno)
                    )
            elif isinstance(node, ast.ImportFrom):
                edges.extend(
                    self._from_edges(source_key, importer_package, node)
                )
            elif isinstance(node, ast.Call) and _is_dynamic_import_call(node):
                edges.append(self._dynamic_edge(source_key, node))
        return edges

    def _resolve_absolute(self, source: str, dotted: str, line: int) -> Edge:
        target = self._index.resolve_absolute(dotted)
        if target is not None:
            return Edge(
                source=source,
                target=target,
                type="STATIC_IMPORT",
                resolved=True,
                line=line,
            )
        return Edge(
            source=source,
            target=None,
            type="STATIC_IMPORT",
            resolved=False,
            line=line,
            raw_specifier=dotted,
            resolution_error=classify_external(dotted, self._external),
        )

    def _static_edge(self, source: str, dotted: str, line: int) -> Edge:
        # `import a.b.c` — try the full dotted name, then its package (a package
        # import resolves to the package __init__).
        target = self._index.resolve_absolute(dotted)
        if target is None and "." in dotted:
            target = self._index.resolve_absolute(dotted.rsplit(".", 1)[0])
        if target is not None:
            return Edge(source, target, "STATIC_IMPORT", True, line)
        return Edge(
            source,
            None,
            "STATIC_IMPORT",
            False,
            line,
            raw_specifier=dotted,
            resolution_error=classify_external(dotted, self._external),
        )

    def _from_edges(
        self, source: str, importer_package: str | None, node: ast.ImportFrom
    ) -> list[Edge]:
        line = node.lineno
        level = node.level or 0

        # Determine the from-clause base module M (absolutized for relative imports;
        # for bare `from . import x`, M is the importer's package).
        if level > 0:
            base = absolutize_relative(importer_package, level, node.module)
            if base is None:
                # Traversal exited the repo root (SPEC §3) — first-class unresolved.
                raw = ("." * level) + (node.module or "")
                return [self._unresolved_relative(source, raw, line)]
        else:
            base = node.module or ""

        # `from M import n` is ambiguous between a submodule M.n and a symbol n in M.
        # Resolve each name as a submodule first (SPEC §3: `from . import x` resolves
        # against the package dir; namespace subpackages have no __init__ to carry a
        # symbol). Names that are not submodules fold into one edge to M, whose
        # `exports` the selector uses to find the symbol (SPEC §5).
        edges: list[Edge] = []
        need_base_edge = False
        for alias in node.names:
            if alias.name == "*":
                need_base_edge = True  # star not expanded; selector uses M's exports
                continue
            sub = f"{base}.{alias.name}" if base else alias.name
            target = self._index.resolve_absolute(sub)
            if target is not None:
                edges.append(Edge(source, target, "STATIC_IMPORT", True, line))
            else:
                need_base_edge = True

        if need_base_edge or not node.names:
            if level > 0:
                edges.append(self._resolve_relative(source, base, line))
            else:
                edges.append(self._resolve_absolute(source, base, line))
        return edges

    def _resolve_relative(self, source: str, dotted: str, line: int) -> Edge:
        # A relative import that does not resolve is module_not_found, not external
        # — it named a repo-internal module that is absent.
        edge = self._resolve_absolute(source, dotted, line)
        if not edge.resolved:
            edge.resolution_error = "module_not_found"
            edge.raw_specifier = dotted
        return edge

    def _unresolved_relative(self, source: str, raw: str, line: int) -> Edge:
        return Edge(source, None, "STATIC_IMPORT", False, line,
                    raw_specifier=raw, resolution_error="external_boundary")

    def _dynamic_edge(self, source: str, node: ast.Call) -> Edge:
        arg = node.args[0] if node.args else None
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            raw = arg.value
        elif arg is not None:
            raw = ast.unparse(arg)
        else:
            raw = ""
        # Dynamic imports are not resolved by policy (SPEC §3), literal or not.
        return Edge(
            source,
            None,
            "DYNAMIC_IMPORT",
            False,
            node.lineno,
            raw_specifier=raw,
            resolution_error="dynamic_template_literal",
        )
