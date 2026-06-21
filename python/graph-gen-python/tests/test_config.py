"""P1 — horos.json config loader (SPEC §2)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from graph_gen_python.config import ConfigError, load_config


def _write(tmp: Path, obj: object) -> Path:
    p = tmp / "horos.json"
    p.write_text(json.dumps(obj), encoding="utf-8")
    return p


class TestConfig(unittest.TestCase):
    def test_loads_and_normalizes(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            p = _write(tmp, {"python_source_roots": ["src/", "."],
                             "external_modules": ["requests", "PIL"]})
            cfg = load_config(p)
            self.assertEqual(cfg.python_source_roots, ("src", "."))
            self.assertEqual(cfg.external_modules, ("requests", "PIL"))
            self.assertRegex(cfg.config_hash, r"^[0-9a-f]{64}$")

    def test_hash_stable_under_key_reorder(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            a = _write(Path(d), {
                "python_source_roots": ["src"], "external_modules": ["numpy"]})
            hash_a = load_config(a).config_hash
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            b = _write(tmp, {"external_modules": ["numpy"],
                             "python_source_roots": ["src"]})
            hash_b = load_config(b).config_hash
        self.assertEqual(hash_a, hash_b)

    def test_missing_file_errors(self) -> None:
        with self.assertRaises(ConfigError):
            load_config("/nonexistent/horos.json")

    def test_missing_key_errors(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = _write(Path(d), {"python_source_roots": ["src"]})
            with self.assertRaises(ConfigError):
                load_config(p)


if __name__ == "__main__":
    unittest.main()
