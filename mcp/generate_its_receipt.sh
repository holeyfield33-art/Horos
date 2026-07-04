#!/usr/bin/env bash
# Phase 5 — Generate full receipt + graph for pallets/itsdangerous.
#
# The MCP server's route_context returns only a receipt summary (4 hash fields).
# verify_receipt needs the full Receipt object.  This script produces it locally
# using scripts/route.mjs (which outputs the full JSON) and the Python generator.
#
# Usage (from repo root):
#   bash mcp/generate_its_receipt.sh
#
# Outputs:
#   /tmp/its-graph.json    — graph artifact (input to verify_receipt)
#   /tmp/its-receipt.json  — full Receipt JSON (input to verify_receipt)
#
# The --key below is the same deterministic seed used by mcp/router_runner.mjs
# (SEED = "00".repeat(32)) so the receipt is internally consistent.

set -euo pipefail

REPO_URL="https://github.com/pallets/itsdangerous"
TASK="verify receipt signature"
DEST="/tmp/its"
GRAPH="/tmp/its-graph.json"
RECEIPT="/tmp/its-receipt.json"
# 32 zero bytes expressed as 64 hex chars — matches SEED in router_runner.mjs
KEY="0000000000000000000000000000000000000000000000000000000000000000"

echo "=== Phase 5: Cloning $REPO_URL ==="
rm -rf "$DEST"
git clone --depth=1 "$REPO_URL" "$DEST"
SHA=$(git -C "$DEST" rev-parse HEAD)
echo "  commit: $SHA"

echo ""
echo "=== Writing synthesised horos.json ==="
# Mirror what _synthesize_python_config does: probe src/, lib/, app/
SOURCE_ROOTS="src"
[ -d "$DEST/lib" ] && SOURCE_ROOTS="src\", \"lib"
[ -d "$DEST/app" ] && SOURCE_ROOTS="$SOURCE_ROOTS\", \"app"
echo "{\"python_source_roots\": [\"$SOURCE_ROOTS\"], \"external_modules\": []}" > "$DEST/horos.json"
echo "  wrote: $(cat "$DEST/horos.json")"

echo ""
echo "=== Running Python graph generator ==="
PYTHONPATH="$(pwd)/python/graph-gen-python" \
  python -m graph_gen_python \
    --repo "$DEST" \
    --config "$DEST/horos.json" \
    --out "$GRAPH" \
    --generated-at "2026-07-04T00:00:00Z" \
    --repository-origin "$REPO_URL" \
    --commit-sha "$SHA"
echo "  graph written to $GRAPH ($(wc -c < "$GRAPH") bytes)"

echo ""
echo "=== Routing + producing full receipt (scripts/route.mjs) ==="
node scripts/route.mjs "$GRAPH" "$TASK" \
  --key "$KEY" \
  --out "$RECEIPT"
echo "  receipt written to $RECEIPT ($(wc -c < "$RECEIPT") bytes)"

echo ""
echo "=== Done. Files ready for verify_receipt ==="
echo "  graph:   $GRAPH"
echo "  receipt: $RECEIPT"
