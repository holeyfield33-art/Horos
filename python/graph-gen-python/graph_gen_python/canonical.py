"""Canonical JSON (``cjson``) and hashing — SPEC P0, §1/§6/§7.

This must produce the SAME bytes as the TypeScript ``cjson`` (``src/canonical/
cjson.ts``): RFC 8785 / JCS — object keys sorted by Unicode code point, no
insignificant whitespace, UTF-8, ECMAScript number form, ``"``/``\\``/control
escaping only (``/`` not escaped, non-ASCII emitted raw).

DECISIONS-py.md C1: the canonical form is produced by stdlib ``json.dumps``, not
a hand-rolled serializer. ``json.dumps(obj, ensure_ascii=False,
separators=(",", ":"), sort_keys=True)`` reproduces every case in
``vectors/canonical-forms.json`` byte-for-byte (Python sorts string keys by code
point, which matches the spec for every key Horos hashes). A hand-rolled escaper
was tried and rejected — it is both unnecessary and a source of subtle drift
(e.g. dropping legitimately-``null`` fields). Every ``null`` value is preserved.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def cjson_bytes(obj: Any) -> bytes:
    """Canonical JSON bytes — the form that feeds every hash.

    ``allow_nan=False`` rejects non-finite floats (``NaN``/``Infinity``), which
    have no canonical form, matching the TS serializer's rejection.
    """
    text = json.dumps(
        obj,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )
    return text.encode("utf-8")


def sha256_hex(data: bytes) -> str:
    """SHA-256 of raw bytes as lowercase hex (matches ``src/canonical/primitives.ts``)."""
    return hashlib.sha256(data).hexdigest()


def graph_artifact_hash(artifact: Any) -> str:
    """``graph_artifact_hash`` = sha256(cjson(artifact))."""
    return sha256_hex(cjson_bytes(artifact))
