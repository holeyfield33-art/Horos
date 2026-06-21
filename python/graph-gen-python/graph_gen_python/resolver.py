"""Static module resolver — SPEC §4, build PR P3.

Hand-rolled, bounded module-to-path mapper. No external import-graph library, no
``sys.path``, no site-packages, no execution (SPEC §1 decision 1). Determinism is
constructed from repo files + the checked-in config.

A resolved import always returns the registered NODE KEY (repo-relative POSIX),
so a resolved edge target is, by construction, a member of the artifact ``nodes``
map (correction C3 — the TS selector silently skips targets that are not node
keys).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass

# Pinned stdlib seed (DECISIONS-py.md: python-stdlib 3.11). Read as a constant
# set of names — never by importing anything.
STDLIB_MODULES: frozenset[str] = frozenset(sys.stdlib_module_names)
STDLIB_VERSION = f"{sys.version_info.major}.{sys.version_info.minor}"


@dataclass(frozen=True)
class Resolved:
    target: str  # node-map key (repo-relative POSIX)


@dataclass(frozen=True)
class Unresolved:
    resolution_error: str  # "module_not_found" | "external_boundary"


Resolution = Resolved | Unresolved


class ModuleIndex:
    """Maps dotted module names to node keys, built from the discovered files.

    ``foo/bar.py`` -> module ``foo.bar`` -> key ``<root>/foo/bar.py`` minus root.
    ``foo/bar/__init__.py`` -> module ``foo.bar``. PEP 420: a file hit does not
    require ``__init__.py`` (SPEC §1 decision 4).
    """

    def __init__(self, node_keys: list[str], source_roots: tuple[str, ...]) -> None:
        self._node_keys = set(node_keys)
        self._source_roots = source_roots
        # (root, dotted-module) -> node key, where root order is preserved by the
        # caller iterating source_roots in config order.
        self._by_root: dict[str, dict[str, str]] = {r: {} for r in source_roots}
        for key in node_keys:
            for root in source_roots:
                rel = self._strip_root(key, root)
                if rel is None:
                    continue
                dotted = self._path_to_module(rel)
                if dotted is not None:
                    # First-wins within a root keeps resolution deterministic.
                    self._by_root[root].setdefault(dotted, key)
                break

    @staticmethod
    def _strip_root(key: str, root: str) -> str | None:
        if root == ".":
            return key
        prefix = root.rstrip("/") + "/"
        if key.startswith(prefix):
            return key[len(prefix):]
        return None

    @staticmethod
    def _path_to_module(rel: str) -> str | None:
        if not rel.endswith(".py"):
            return None
        stem = rel[: -len(".py")]
        parts = stem.split("/")
        if parts[-1] == "__init__":
            parts = parts[:-1]
        if not parts:
            return None
        return ".".join(parts)

    def resolve_absolute(self, dotted: str) -> str | None:
        """Return the node key for an absolute dotted module, or None."""
        for root in self._source_roots:
            hit = self._by_root[root].get(dotted)
            if hit is not None:
                return hit
        return None

    def package_of(self, node_key: str) -> str | None:
        """The dotted package name a file belongs to (its parent package).

        ``src/pkg/sub/mod.py`` with root ``src`` -> ``pkg.sub``. ``__init__.py``
        is itself the package, so its package is the module it represents.
        """
        for root in self._source_roots:
            rel = self._strip_root(node_key, root)
            if rel is None:
                continue
            module = self._path_to_module(rel)
            if module is None:
                return None
            if rel.endswith("/__init__.py") or rel == "__init__.py":
                return module  # the __init__ IS the package
            # drop the module's own final segment to get its package
            if "." in module:
                return module.rsplit(".", 1)[0]
            return ""  # top-level module: package is the root namespace
        return None


def absolutize_relative(
    importer_package: str | None, level: int, module: str | None
) -> str | None:
    """Convert a relative import to an absolute dotted name.

    ``level`` is the number of leading dots. Returns None if traversal exits the
    repo root (which the caller maps to external_boundary). ``importer_package``
    is the dotted package of the importing file ('' for a top-level module).
    """
    if importer_package is None:
        return None
    # level 1 (`from . import x`) resolves against the importer's own package;
    # each extra dot ascends one package. Explicit pop avoids the no-op bug noted
    # in correction C4.
    parts = [p for p in importer_package.split(".") if p]
    for _ in range(level - 1):
        if parts:
            parts.pop()
        else:
            return None  # ascends past the repo root -> external_boundary
    if module:
        parts.extend(module.split("."))
    if not parts:
        return None
    return ".".join(parts)


def classify_external(dotted: str, external_modules: tuple[str, ...]) -> str:
    """An unresolved absolute import: external_boundary if its top segment is a
    known stdlib or configured external module, else module_not_found."""
    top = dotted.split(".", 1)[0]
    if top in STDLIB_MODULES or top in external_modules:
        return "external_boundary"
    return "module_not_found"
