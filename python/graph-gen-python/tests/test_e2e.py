"""P5 — end-to-end acceptance: real TS router parity + determinism (SPEC §10).

The authoritative proof (correction C5): a Python-generated artifact is fed to
the UNCHANGED TS router (built in ``dist/``) which loads it, runs a selection,
builds + signs a receipt, and verifies it — returning PASS. If ``dist/`` or
``node`` is unavailable the router test self-skips (it cannot be faked by a
Python re-implementation).

Determinism: generating twice on the same commit + config yields a byte-identical
artifact and identical graph_artifact_hash.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from graph_gen_python.artifact import generate
from graph_gen_python.canonical import graph_artifact_hash
from graph_gen_python.config import load_config

PKG_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = PKG_ROOT.parent.parent
FIXTURE = PKG_ROOT / "tests" / "fixtures" / "py-project"
PARITY_SCRIPT = PKG_ROOT / "tests" / "parity" / "verify_parity.mjs"
DIST = REPO_ROOT / "dist"


def _generate():
    config = load_config(FIXTURE / "horos.json")
    return generate(
        FIXTURE,
        config,
        repository_origin="github.com/org/repo",
        commit_sha="4b825dc642cb6eb9a00b213b2e3fc7e42d99217c",
        generated_at="2026-06-21T00:00:00+00:00",
    )


class TestEndToEnd(unittest.TestCase):
    def test_determinism_two_runs_identical(self) -> None:
        a = _generate()
        b = _generate()
        self.assertEqual(
            json.dumps(a.artifact, sort_keys=True),
            json.dumps(b.artifact, sort_keys=True),
        )
        self.assertEqual(a.artifact_hash, b.artifact_hash)
        # artifact_hash is sha256(cjson(artifact)) — the router's graph_artifact_hash.
        self.assertEqual(a.artifact_hash, graph_artifact_hash(a.artifact))

    def test_router_parity_pass(self) -> None:
        node = shutil.which("node")
        if node is None or not (DIST / "graph" / "index.js").exists():
            self.skipTest(
                "TS router not built (dist/) or node unavailable; "
                "run `npm install && npm run build` at the repo root"
            )
        result = _generate()
        with tempfile.TemporaryDirectory() as d:
            graph_path = Path(d) / "graph.json"
            graph_path.write_text(
                json.dumps(result.artifact, indent=2), encoding="utf-8"
            )
            proc = subprocess.run(
                [node, str(PARITY_SCRIPT), str(graph_path), "helper relutil leaf"],
                capture_output=True,
                text=True,
            )
        self.assertEqual(
            proc.returncode,
            0,
            f"router verify did not PASS:\nstdout={proc.stdout}\nstderr={proc.stderr}",
        )
        self.assertIn("PASS", proc.stdout)


if __name__ == "__main__":
    unittest.main()
