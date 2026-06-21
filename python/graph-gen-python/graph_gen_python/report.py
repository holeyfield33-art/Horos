"""Completion report — SPEC §8 (decision 7), build PR P4.

After the artifact is emitted, print the distinct set of top-level module names
classified ``module_not_found`` so the user can move genuine third-party names
into ``external_modules`` and re-run. Pure reporting — it does not affect the
artifact or its hash.
"""

from __future__ import annotations

from collections.abc import Sequence


def format_report(module_not_found: Sequence[str]) -> str:
    if not module_not_found:
        return "No unresolved (module_not_found) top-level modules."
    names = ", ".join(module_not_found)
    return (
        "Unresolved top-level modules (candidates for external_modules):\n"
        f"  {names}\n"
        "Add genuine third-party names to horos.json -> external_modules and re-run."
    )
