"""P4 — artifact assembly, metadata, completion report (SPEC §7/§8)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from graph_gen_python.artifact import generate
from graph_gen_python.config import load_config
from graph_gen_python.report import format_report

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "py-project"


def _generate():
    config = load_config(FIXTURE / "horos.json")
    return generate(
        FIXTURE,
        config,
        repository_origin="github.com/org/repo",
        commit_sha="4b825dc642cb6eb9a00b213b2e3fc7e42d99217c",
        generated_at="2026-06-21T00:00:00+00:00",
    )


class TestArtifact(unittest.TestCase):
    def setUp(self) -> None:
        self.result = _generate()
        self.artifact = self.result.artifact

    def test_schema_and_shape(self) -> None:
        self.assertEqual(self.artifact["$schema"], "context-graph-v0")
        # nodes is a keyed MAP (correction C2), not a list.
        self.assertIsInstance(self.artifact["nodes"], dict)
        self.assertIn("src/pkg/main.py", self.artifact["nodes"])

    def test_metadata(self) -> None:
        meta = self.artifact["metadata"]
        self.assertEqual(meta["generator"]["name"], "@horos/graph-gen-python")
        names = [e["name"] for e in meta["resolver_stack"]]
        self.assertIn("python-stdlib", names)
        self.assertIn("horos-py-resolver", names)
        self.assertRegex(meta["provenance"]["tree_hash"], r"^[0-9a-f]{64}$")

    def test_completeness_partial_with_unresolved(self) -> None:
        # The fixture has stdlib/external/missing/dynamic imports -> unresolved > 0.
        self.assertEqual(self.artifact["metadata"]["completeness"], "partial")
        self.assertGreater(
            self.artifact["metadata"]["coverage"]["unresolved_edges"], 0
        )

    def test_module_not_found_reported(self) -> None:
        self.assertIn("totally_missing_pkg", self.result.unresolved_module_not_found)
        report = format_report(self.result.unresolved_module_not_found)
        self.assertIn("totally_missing_pkg", report)
        self.assertIn("external_modules", report)

    def test_artifact_is_valid_json(self) -> None:
        round_tripped = json.loads(json.dumps(self.artifact))
        self.assertEqual(round_tripped["$schema"], "context-graph-v0")


if __name__ == "__main__":
    unittest.main()
