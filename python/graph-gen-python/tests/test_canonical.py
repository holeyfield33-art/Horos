"""P0 — cjson parity gate (the spine).

If any frozen cjson vector cannot be reproduced byte-for-byte, the generator's
output will not verify through the TS router and nothing else is worth building.
The vectors in ``vectors/canonical-forms.json`` were produced by the TS ``cjson``
and serve as the cross-language parity vector.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from graph_gen_python.canonical import cjson_bytes, sha256_hex

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((REPO_ROOT / "vectors" / "canonical-forms.json").read_text())


class TestCjsonParity(unittest.TestCase):
    def test_vectors_reproduce_canonical_and_hash(self) -> None:
        cases = VECTORS["cjson"]
        self.assertGreater(len(cases), 0)
        for case in cases:
            expected_canonical = case["canonical"]
            expected_sha = case["sha256"]
            for shuffled in case["inputs"]:
                produced = cjson_bytes(shuffled)
                self.assertEqual(
                    produced.decode("utf-8"),
                    expected_canonical,
                    f"canonical mismatch for {case['name']!r}",
                )
                self.assertEqual(
                    sha256_hex(produced),
                    expected_sha,
                    f"sha256 mismatch for {case['name']!r}",
                )

    def test_shuffled_keys_identical_bytes(self) -> None:
        a = {"b": 2, "a": 1, "c": {"y": True, "x": None}}
        b = {"c": {"x": None, "y": True}, "a": 1, "b": 2}
        self.assertEqual(cjson_bytes(a), cjson_bytes(b))

    def test_null_values_preserved(self) -> None:
        # An unresolved edge carries target: null — it must survive canonicalization.
        self.assertEqual(
            cjson_bytes({"target": None, "resolved": False}).decode("utf-8"),
            '{"resolved":false,"target":null}',
        )

    def test_non_finite_rejected(self) -> None:
        with self.assertRaises(ValueError):
            cjson_bytes({"x": float("inf")})
        with self.assertRaises(ValueError):
            cjson_bytes({"x": float("nan")})


if __name__ == "__main__":
    unittest.main()
