"""P3 — import extraction + static resolver golden test (SPEC §3/§4).

The golden edge list pins every §3 row produced from the py-project fixture's
main.py: resolved first-party imports (absolute + relative + PEP 420 namespace),
external_boundary (stdlib, configured external, relative-exits-root),
module_not_found, and unresolved DYNAMIC_IMPORT (literal and non-literal).
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

from graph_gen_python.extract import EdgeBuilder
from graph_gen_python.files import discover_py_files
from graph_gen_python.resolver import ModuleIndex

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "py-project"
SOURCE_ROOTS = ("src",)
EXTERNAL = ("requests",)


def _build_edges_for_main() -> list[dict[str, object]]:
    node_keys = discover_py_files(FIXTURE, SOURCE_ROOTS)
    index = ModuleIndex(node_keys, SOURCE_ROOTS)
    builder = EdgeBuilder(index, EXTERNAL)
    main_key = "src/pkg/main.py"
    tree = ast.parse((FIXTURE / main_key).read_text())
    return [e.to_dict() for e in builder.edges_for_file(main_key, tree)]


class TestResolver(unittest.TestCase):
    def setUp(self) -> None:
        self.edges = _build_edges_for_main()

    def _find_resolved(self, target: str) -> dict[str, object] | None:
        return next(
            (e for e in self.edges if e.get("resolved") and e.get("target") == target),
            None,
        )

    def _find_unresolved(self, raw: str) -> dict[str, object] | None:
        return next(
            (
                e
                for e in self.edges
                if not e.get("resolved") and e.get("raw_specifier") == raw
            ),
            None,
        )

    def test_resolved_targets_are_node_keys(self) -> None:
        # Correction C3: every resolved target must be a real discovered node key.
        node_keys = set(discover_py_files(FIXTURE, SOURCE_ROOTS))
        for e in self.edges:
            if e.get("resolved"):
                self.assertIn(e["target"], node_keys)

    def test_absolute_first_party(self) -> None:
        self.assertIsNotNone(self._find_resolved("src/pkg/helpers.py"))

    def test_bare_relative_submodule(self) -> None:
        # `from . import relutil` -> submodule pkg.relutil
        self.assertIsNotNone(self._find_resolved("src/pkg/relutil.py"))

    def test_namespace_package_resolves(self) -> None:
        # `from .sub import leaf` resolves with no src/pkg/sub/__init__.py (PEP 420)
        self.assertIsNotNone(self._find_resolved("src/pkg/sub/leaf.py"))

    def test_stdlib_is_external_boundary(self) -> None:
        os_edge = self._find_unresolved("os")
        self.assertIsNotNone(os_edge)
        assert os_edge is not None
        self.assertEqual(os_edge["resolution_error"], "external_boundary")

    def test_configured_external_boundary(self) -> None:
        req = self._find_unresolved("requests")
        assert req is not None
        self.assertEqual(req["resolution_error"], "external_boundary")

    def test_relative_exits_repo_root_is_external_boundary(self) -> None:
        esc = self._find_unresolved("...escape")
        assert esc is not None
        self.assertEqual(esc["resolution_error"], "external_boundary")

    def test_module_not_found(self) -> None:
        missing = self._find_unresolved("totally_missing_pkg")
        assert missing is not None
        self.assertEqual(missing["resolution_error"], "module_not_found")
        # INVARIANT: present as a first-class unresolved edge, never dropped.
        self.assertFalse(missing["resolved"])
        self.assertIsNone(missing["target"])

    def test_dynamic_imports_unresolved(self) -> None:
        literal = self._find_unresolved("pkg.relutil")
        assert literal is not None
        self.assertEqual(literal["type"], "DYNAMIC_IMPORT")
        self.assertEqual(literal["resolution_error"], "dynamic_template_literal")
        # non-literal importlib.import_module(name)
        nonlit = next(
            (
                e
                for e in self.edges
                if e.get("type") == "DYNAMIC_IMPORT" and e.get("raw_specifier") == "name"
            ),
            None,
        )
        self.assertIsNotNone(nonlit)
        # __import__("os") literal
        builtin = next(
            (
                e
                for e in self.edges
                if e.get("type") == "DYNAMIC_IMPORT" and e.get("raw_specifier") == "os"
            ),
            None,
        )
        self.assertIsNotNone(builtin)

    def test_conditional_import_parsed(self) -> None:
        # `import json` inside `if True:` is parsed regardless of control flow.
        j = self._find_unresolved("json")
        assert j is not None
        self.assertEqual(j["resolution_error"], "external_boundary")


if __name__ == "__main__":
    unittest.main()
