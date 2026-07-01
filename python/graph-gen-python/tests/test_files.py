"""P2 — file walk, content hash, token count, exports (SPEC §5/§6)."""

from __future__ import annotations

import ast
import hashlib
import unittest
from pathlib import Path

import pytest

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


def test_build_pyfile_rejects_symlink_escape(tmp_path: Path) -> None:
    """A symlink inside the repo root pointing outside it must raise ValueError."""
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    # Place a "secret" file outside the repo root that a symlink could reach.
    outside = tmp_path / "secret.py"
    outside.write_text("SECRET = 1\n")
    # Create the malicious symlink inside the repo.
    link = repo_root / "escape_link.py"
    link.symlink_to(outside)
    with pytest.raises(ValueError, match="path escapes repo root"):
        build_pyfile(repo_root, "escape_link.py")


if __name__ == "__main__":
    unittest.main()
