"""File discovery, content hash, token count, exports — SPEC §5/§6, build PR P2.

Walks ``*.py`` under the configured source roots (git-tracked when available),
and builds the per-file node fields. All paths are repo-relative POSIX strings —
the same key used in the artifact ``nodes`` map and as resolved-edge targets.
"""

from __future__ import annotations

import ast
import io
import subprocess
import tokenize
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from .canonical import sha256_hex

# DECISIONS-py.md: token_count counts tokenize.generate_tokens output excluding
# these structural / trivia kinds. Frozen — changing this set is a breaking change
# to every token_count vector.
_EXCLUDED_TOKENS = frozenset(
    {
        tokenize.ENCODING,
        tokenize.NL,
        tokenize.NEWLINE,
        tokenize.INDENT,
        tokenize.DEDENT,
        tokenize.COMMENT,
        tokenize.ENDMARKER,
    }
)


@dataclass(frozen=True)
class PyFile:
    """A discovered first-party Python file, keyed by repo-relative POSIX path."""

    rel_path: str
    abs_path: Path
    source: str
    content_hash: str
    token_count: int
    exports: tuple[str, ...] = field(default=())


def _is_within_roots(rel_posix: str, roots: tuple[str, ...]) -> bool:
    parts = PurePosixPath(rel_posix)
    for root in roots:
        if root == ".":
            return True
        rootp = PurePosixPath(root)
        if rootp == parts or rootp in parts.parents:
            return True
    return False


def _git_tracked_files(repo_root: Path) -> list[str] | None:
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    raw = out.stdout.decode("utf-8")
    return [p for p in raw.split("\0") if p]


def _filesystem_py_files(repo_root: Path) -> list[str]:
    files: list[str] = []
    for p in repo_root.rglob("*.py"):
        if any(part == "__pycache__" for part in p.parts):
            continue
        files.append(p.relative_to(repo_root).as_posix())
    return files


def discover_py_files(repo_root: Path, source_roots: tuple[str, ...]) -> list[str]:
    """Repo-relative POSIX ``.py`` paths under ``source_roots``, sorted.

    Prefers git-tracked files for reproducibility; falls back to a filesystem
    walk when the repo is not a git checkout.
    """
    def _filter(candidates: list[str]) -> list[str]:
        return [
            c
            for c in candidates
            if c.endswith(".py") and _is_within_roots(c, source_roots)
        ]

    tracked = _git_tracked_files(repo_root)
    py = _filter(tracked) if tracked is not None else []
    # Fall back to a filesystem walk when the target is not a git repo, or when no
    # tracked .py exist under the roots (e.g. an uncommitted working copy). When
    # tracked .py are present they are authoritative — gitignored/untracked junk is
    # excluded, anchoring determinism to the committed tree.
    if not py:
        py = _filter(_filesystem_py_files(repo_root))
    return sorted(set(py))


def count_tokens(source: str) -> int:
    """Deterministic stdlib token count (NOT a model tokenizer). See DECISIONS-py.md."""
    readline = io.StringIO(source).readline
    count = 0
    for tok in tokenize.generate_tokens(readline):
        if tok.type in _EXCLUDED_TOKENS:
            continue
        count += 1
    return count


def collect_exports(tree: ast.Module) -> tuple[str, ...]:
    """Exports per SPEC §5: ``__all__`` literal list/tuple if present and static,
    else top-level def/async def/class names not beginning with ``_``."""
    all_names = _static_dunder_all(tree)
    if all_names is not None:
        return tuple(sorted(set(all_names)))

    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if not node.name.startswith("_"):
                names.add(node.name)
    return tuple(sorted(names))


def _static_dunder_all(tree: ast.Module) -> list[str] | None:
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        targets = node.targets
        if len(targets) != 1 or not isinstance(targets[0], ast.Name):
            continue
        if targets[0].id != "__all__":
            continue
        value = node.value
        if not isinstance(value, (ast.List, ast.Tuple)):
            return None  # __all__ present but not a static literal -> fall back
        result: list[str] = []
        for elt in value.elts:
            if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                result.append(elt.value)
            else:
                return None  # non-literal element -> not statically usable
        return result
    return None


def build_pyfile(repo_root: Path, rel_path: str) -> PyFile:
    abs_path = repo_root / rel_path
    raw_bytes = abs_path.read_bytes()
    content_hash = sha256_hex(raw_bytes)
    source = raw_bytes.decode("utf-8")
    tree = ast.parse(source, filename=rel_path)
    return PyFile(
        rel_path=rel_path,
        abs_path=abs_path,
        source=source,
        content_hash=content_hash,
        token_count=count_tokens(source),
        exports=collect_exports(tree),
    )
