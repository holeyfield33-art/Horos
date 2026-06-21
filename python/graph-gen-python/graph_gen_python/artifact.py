"""Artifact assembly + provenance — SPEC §7, build PR P4.

Assembles the full ``context-graph-v0`` artifact from discovered files and
extracted edges. The artifact shape, metadata, and hashing all match the TS
router (``src/graph/types.ts``, ``src/canonical/manifest.ts``) so a
Python-generated graph verifies through the unchanged router.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import GENERATOR_NAME, GENERATOR_VERSION
from .canonical import graph_artifact_hash, sha256_hex
from .config import HorosConfig
from .extract import Edge, EdgeBuilder
from .files import PyFile, build_pyfile, discover_py_files
from .resolver import STDLIB_VERSION, ModuleIndex
import ast

SCHEMA = "context-graph-v0"
RESOLVER_NAME = "horos-py-resolver"


@dataclass
class GenerationResult:
    artifact: dict[str, object]
    artifact_hash: str
    unresolved_module_not_found: tuple[str, ...]


def _manifest_tree_hash(repo_root: Path) -> str:
    """§2.3 tree_hash: git-tracked paths, byte-sorted, LF-joined, no trailing
    newline, sha256. Matches src/canonical/manifest.ts exactly."""
    try:
        out = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", "HEAD"],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
        paths = [p for p in out.stdout.decode("utf-8").split("\n") if p]
    except (OSError, subprocess.CalledProcessError):
        paths = []
    # Byte-order sort (UTF-8), LF-joined, no trailing newline.
    body = "\n".join(sorted(paths, key=lambda p: p.encode("utf-8")))
    return sha256_hex(body.encode("utf-8"))


def _commit_sha(repo_root: Path) -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
        return out.stdout.decode("utf-8").strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def _node_dict(pf: PyFile) -> dict[str, object]:
    node: dict[str, object] = {
        "file_path": pf.rel_path,
        "language": "python",
        "content_hash": pf.content_hash,
        "token_count": pf.token_count,
    }
    if pf.exports:
        node["exports"] = list(pf.exports)
    return node


def generate(
    repo_root: Path,
    config: HorosConfig,
    *,
    repository_origin: str,
    commit_sha: str | None = None,
    generated_at: str,
    command_executed: str | None = None,
    execution_mode: str = "ci",
) -> GenerationResult:
    node_keys = discover_py_files(repo_root, config.python_source_roots)
    index = ModuleIndex(node_keys, config.python_source_roots)
    builder = EdgeBuilder(index, config.external_modules)

    nodes: dict[str, dict[str, object]] = {}
    edges: list[Edge] = []
    for key in node_keys:  # node_keys is sorted -> deterministic file order
        pf = build_pyfile(repo_root, key)
        nodes[key] = _node_dict(pf)
        tree = ast.parse(pf.source, filename=key)
        edges.extend(builder.edges_for_file(key, tree))

    edge_dicts = [e.to_dict() for e in edges]
    unresolved_count = sum(1 for e in edge_dicts if e["resolved"] is False)

    mnf = sorted(
        {
            str(e["raw_specifier"]).split(".", 1)[0]
            for e in edge_dicts
            if e.get("resolution_error") == "module_not_found" and e.get("raw_specifier")
        }
    )

    resolved_sha = commit_sha if commit_sha is not None else _commit_sha(repo_root)

    artifact: dict[str, object] = {
        "$schema": SCHEMA,
        "metadata": {
            "generator": {
                "name": GENERATOR_NAME,
                "version": GENERATOR_VERSION,
                "command_executed": command_executed
                or "python -m graph_gen_python",
                "execution_mode": execution_mode,
            },
            "config_hash": config.config_hash,
            "provenance": {
                "repository_origin": repository_origin,
                "commit_sha": resolved_sha,
                "tree_hash": _manifest_tree_hash(repo_root),
                "generated_at": generated_at,
            },
            "resolver_stack": [
                {"name": "python-stdlib", "version": STDLIB_VERSION},
                {"name": RESOLVER_NAME, "version": GENERATOR_VERSION},
            ],
            "coverage": {
                "files_total": len(node_keys),
                "files_indexed": len(nodes),
                "edges_total": len(edge_dicts),
                "unresolved_edges": unresolved_count,
            },
            "completeness": "complete" if unresolved_count == 0 else "partial",
        },
        "nodes": nodes,
        "edges": edge_dicts,
    }

    return GenerationResult(
        artifact=artifact,
        artifact_hash=graph_artifact_hash(artifact),
        unresolved_module_not_found=tuple(mnf),
    )
