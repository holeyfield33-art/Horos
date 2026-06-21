"""``horos.json`` config loader — SPEC §2, build PR P1.

The config is the first-party/external boundary decision (manual, checked-in —
never derived from a dependency manifest, see SPEC §1 decision 2). Its full
canonical text is hashed into ``metadata.config_hash`` so two machines with the
same commit and same ``horos.json`` produce identical graphs.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .canonical import cjson_bytes, sha256_hex


class ConfigError(Exception):
    """Raised when ``horos.json`` is missing or malformed."""


@dataclass(frozen=True)
class HorosConfig:
    python_source_roots: tuple[str, ...]
    external_modules: tuple[str, ...]
    config_hash: str


def _require_str_list(parsed: dict[str, object], key: str) -> list[str]:
    if key not in parsed:
        raise ConfigError(f"horos.json: missing required key {key!r}")
    value = parsed[key]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ConfigError(f"horos.json: {key!r} must be a list of strings")
    return [str(v) for v in value]


def _normalize_root(root: str) -> str:
    """Repo-relative POSIX form. '.' stays '.'; trailing/leading slashes trimmed."""
    posix = root.replace("\\", "/").strip("/")
    return posix if posix else "."


def load_config(config_path: Path | str) -> HorosConfig:
    path = Path(config_path)
    if not path.is_file():
        raise ConfigError(f"horos.json not found: {path}")
    try:
        raw = path.read_text(encoding="utf-8")
        parsed = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"horos.json is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ConfigError("horos.json must be a JSON object")

    source_roots = _require_str_list(parsed, "python_source_roots")
    external_modules = _require_str_list(parsed, "external_modules")

    # config_hash is over the parsed config exactly as written (canonicalized),
    # so reordering keys does not change the hash.
    config_hash = sha256_hex(cjson_bytes(parsed))

    normalized_roots = tuple(_normalize_root(r) for r in source_roots)
    return HorosConfig(
        python_source_roots=normalized_roots,
        external_modules=tuple(external_modules),
        config_hash=config_hash,
    )
