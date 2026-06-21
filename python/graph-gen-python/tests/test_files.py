"""P2 — file walk, content hash, token count, exports (SPEC §5/§6)."""

from __future__ import annotations

import ast
import hashlib
import unittest
from pathlib import Path

from graph_gen_python.files import (
    build_pyfile,
    collect_exports,
    count_tokens,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "files"

# Frozen token_count vector (DECISIONS-py.md exclusion set). Recompute only on an
# intentional, documented change to the exclusion set.
WITHOUT_ALL_TOKEN_COUNT = 34


class TestFiles(unittest.TestCase):
    def test_exports_with_dunder_all(self) -> None:
        tree = ast.parse((FIXTURES / "with_all.py").read_text())
        self.assertEqual(collect_exports(tree), ("Public_B", "public_a"))

    def test_exports_without_dunder_all(self) -> None:
        tree = ast.parse((FIXTURES / "without_all.py").read_text())
        # Non-underscore def/async-def/class only; module constants excluded.
        self.assertEqual(
            collect_exports(tree), ("Widget", "also_visible", "visible")
        )

    def test_token_count_frozen_vector(self) -> None:
        src = (FIXTURES / "without_all.py").read_text()
        self.assertEqual(count_tokens(src), WITHOUT_ALL_TOKEN_COUNT)

    def test_content_hash_is_sha256_of_raw_bytes(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        rel = (FIXTURES / "with_all.py").resolve().relative_to(repo_root).as_posix()
        pf = build_pyfile(repo_root, rel)
        expected = hashlib.sha256((FIXTURES / "with_all.py").read_bytes()).hexdigest()
        self.assertEqual(pf.content_hash, expected)
        self.assertEqual(pf.exports, ("Public_B", "public_a"))


if __name__ == "__main__":
    unittest.main()
