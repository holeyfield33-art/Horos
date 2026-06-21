# Horos MCP Server — Specification v0

> Status: **LOCKED** — multi-node relay consensus on architecture; graph-source decision
> made by the operator (A for v1, C deferred).
> A Render-hosted MCP server exposing `route_context`. Wraps the verified Python generator
> + the frozen TS router. Does NOT modify the router, receipt schema, or canonical layer.

---

## 1. What this is

A real **MCP server** (official MCP Python SDK, `FastMCP`, **streamable-HTTP** transport)
hosted on **Render**, exposing one tool, `route_context`, that:
clones a committed repo at a ref → generates the dependency graph in-request (Python
generator) → routes it through the unchanged TS router (`dist/`) → returns the selected
files, exclusions, an honest unresolved signal, and the signed receipt.

It is NOT a REST API. It routes **committed repos it clones**, not local working trees
(the local CLI covers the working-tree case).

---

## 2. Graph source — DECISION: A for v1 (generate in-request)

v1 generates the graph inside the request. This was chosen over the "consume a committed
graph" option (B) and the hybrid (C), against a 3-1 node vote for C, for two decisive
reasons:

1. **In a public repo-cloning deployment, the original spec's generate/consume boundary
   inverts.** The base Horos spec kept graph generation out of the router because it
   assumed a *trusted* graph producer (a team's CI) and an independent selector. On a
   public endpoint cloning arbitrary/owned repos, a committed `graph.json` is an
   **attacker-controllable input** — a doctored graph could hide files and the router
   would sign a clean receipt over it. Generating in-request from parsing rules **frozen
   in the server image** removes that tampering surface. For this deployment, A is the
   *more* trustworthy option, not the lesser one.
2. **A requires no change to the FROZEN router.** Under A, every receipt's graph is
   generated-in-request by definition, so no provenance-origin field is needed and the
   locked receipt schema is untouched.

**Why the vote (3-1 for C) was misleading — two different threat models.** The base spec
and this deployment are solving different problems, which is why preserving the
generate/consume boundary scored high on a vote but loses on the merits here:

| Context | Primary concern the boundary addresses |
|---------|----------------------------------------|
| Original Horos spec (Round 1) | Selector attestation *independence* — keep the router honest about a graph from a trusted producer |
| Public Render MCP (this spec) | *Untrusted repository inputs* — a committed graph is attacker-controllable |

These are not the same threat model. The original boundary assumed a trusted graph
producer; the public-cloning deployment does not have one. So the dissenting node did not
lose an argument — it changed the premise by showing the deployment's threat model differs
from the one that originally justified graph-consumption separation. The decisive question
becomes "which input is harder to falsify without detection — raw source tree, or derived
graph artifact?" and for an untrusted remote repo, the source tree wins. Generating
in-request from rules frozen in the server image is therefore the higher-trust option here.

**Honest note on trust (recorded, not hidden):** for a single operator routing their own
repos, neither A nor B buys meaningful *trust* separation — the operator controls every
end. B's advantages are operational (pre-existing, reusable, inspectable graph), not trust.
The boundary only becomes load-bearing when the graph producer and the router operator are
**different trusted parties**. See §9 (deferred C).

---

## 3. Tool surface

```json
{
  "name": "route_context",
  "description": "Clone a repo at a ref, generate its dependency graph, route the minimal context for a task via the Horos selector, and return the selected files plus a signed receipt.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "repo":  { "type": "string", "description": "Git HTTPS URL or owner/repo shorthand" },
      "task":  { "type": "string", "description": "The task the context is for" },
      "ref":   { "type": "string", "description": "Branch, tag, or commit SHA. Default: remote default branch HEAD" },
      "config":{ "type": "string", "description": "Repo-relative path to horos.json. Default: horos.json" },
      "manual_include": { "type": "array", "items": { "type": "string" }, "default": [] }
    },
    "required": ["repo", "task"]
  }
}
```

`add_external_modules` is **out of scope** (unanimous). A config write on an ephemeral
clone is lost and would produce non-reproducible provenance. Instead, `route_context`
returns suggested `external_modules` in its response (see §6) for the user to commit.

### Response shape (what the model receives)
```json
{
  "repo_commit": "hex",
  "selection_status": "complete | partial",
  "selected_files": [ { "path": "src/main.py", "rank": 1, "token_count": 450 } ],
  "exclusions":     [ { "path": "tests/test_main.py", "reason": "HEURISTIC_IGNORE_TESTS" } ],
  "unresolved_signal": null,                         // or the §6 block when partial
  "suggested_external_modules": [],                  // populated when partial
  "receipt": {
    "receipt_hash": "hex",
    "verified": true,
    "task_hash": "hex",
    "config_hash": "hex",
    "graph_artifact_hash": "hex"
  }
}
```

The full graph artifact and full receipt body are **never inlined** (§7).

---

## 4. Repo acquisition

- **Clone:** per-request temp dir (`tempfile.TemporaryDirectory`, e.g. `/tmp/horos-<uuid>/`),
  deleted after the call. Shallow + blobless: `git clone --depth 1 --filter=blob:none`
  at the requested ref. For an explicit SHA not at a branch tip:
  `git init && git fetch --depth 1 origin <sha> && git checkout FETCH_HEAD`.
- **Commit capture:** `git rev-parse HEAD` → provenance `commit_sha`.
- **Private repos:** the service holds a **read-only** `GITHUB_TOKEN` (env var). The clone
  URL is rewritten server-side to `https://x-access-token:${GITHUB_TOKEN}@github.com/...`.
  Raw credentials are **never** accepted from tool input.
- **Determinism:** `generated_at` is pinned to the commit timestamp
  (`git log -1 --format=%cI`), NOT wall clock, and passed to the generator via
  `--generated-at`. Same `repo`+`ref`+`config` → identical graph hash → identical receipt.

---

## 5. Cross-runtime orchestration

One polyglot Render container: `python:3.11-slim` base + Node.js installed; the image
builds the TS router (`npm ci && npm run build` → `dist/`) and includes the Python
generator package.

Per request, the FastMCP (Python) handler:
1. clone → read commit timestamp;
2. `subprocess.run(["python","-m","graph_gen_python","--repo",ws,"--config",cfg,"--out",tmp_graph,"--generated-at",ts])`;
3. `subprocess.run(["node","dist/cli/horos.js", ...])` over `tmp_graph` (the proven router
   invocation — reuse exactly, do not re-implement);
4. parse the router's structured JSON, shape the §3 response.

Any non-zero exit or validation error from either stage → a clean MCP tool error
(`graph_generation_failed` / `router_failed`) with the captured stderr summarized. No RPC
layer between runtimes; temp-file artifact passing only.

---

## 6. Honest-failure surface (the product's whole point)

If the generated graph is `partial` (any unresolved / `module_not_found` edges),
`route_context` must NOT present the selection as complete. The response sets
`selection_status: "partial"` and populates:

```json
"unresolved_signal": {
  "warning": "Selection may be incomplete: unresolved dependencies were found. Files reachable only through these may be missing from the selection.",
  "unresolved_symbols": ["requests", "PIL"],
  "module_not_found": ["totally_missing_pkg"]
},
"suggested_external_modules": ["requests", "PIL"]
```

Because the user cannot edit `horos.json` on an ephemeral clone, the tool hands back the
exact `external_modules` additions to commit upstream, then re-run. This is how a partial
result stays actionable instead of being a dead end.

---

## 7. Response size discipline

Inline: `selected_files`, `exclusions`, `unresolved_signal`, `suggested_external_modules`,
and the thin receipt summary (hashes + verify status). NOT inlined: the full graph
artifact (internal temp file, discarded after the call) and the full receipt body
(referenced by hash; optionally written to object storage and returned by URI if a body is
needed).

---

## 8. Auth + safety (public endpoint)

- **Transport auth:** bearer token required on every MCP request
  (`Authorization: Bearer ${HOROS_SERVER_SECRET}`), validated before tool execution via
  ASGI middleware. Unauthenticated traffic rejected at the gateway.
- **GitHub token:** read-only `contents` scope only.
- **Allowlist:** `github.com` only in v1.
- **Resource caps (reject if exceeded):** max repo size, max file count, max clone
  duration, max generation duration. Starting bounds: ~500 MB, ~50k files, 60 s clone,
  120 s processing.
- **Reject:** recursive submodule expansion, non-github hosts, arbitrary git protocols.
- **Latency:** measured order of magnitude for a ~500-file Python repo is
  clone+generate+route ≈ **2–15 s**, inside a synchronous window. **No async job-queue in
  v1.** Introduce async/polling ONLY if measured real repos exceed the timeout budget.

### Run entrypoint (SDK-verified)
```python
from mcp.server.fastmcp import FastMCP
import os
mcp = FastMCP("Horos")
# @mcp.tool() route_context ...
if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="0.0.0.0", port=int(os.environ["PORT"]))
```

---

## 9. DEFERRED — Option C (committed-graph path), do NOT build in v1

C becomes worth building only if Horos routes repos where the **graph producer and the
router operator are different trusted parties** (e.g. a team's CI commits `graph.json`,
a separate auditor runs Horos). In that scenario, preferring a committed graph buys real
producer/attester separation. Until that scenario exists, C is speculative.

When C is built:
- `route_context` prefers a committed `graph.json` if present; falls back to in-request
  generation if absent.
- The receipt MUST record which path produced the graph, so a verifier can tell from the
  receipt alone. This requires a **receipt schema addition** — e.g.
  `graph_source: "committed" | "generated_in_request"` — which **touches the FROZEN
  router and receipt schema**. That is a real cost: it re-opens the locked attestation
  core and requires re-running the full receipt/verify test suite + cross-language vectors.
- For an untrusted committed graph, C must NOT weaken the §2 anti-tampering property:
  a committed graph from an untrusted repo is only as trustworthy as the committer. C
  should surface graph origin so the model/auditor can weigh it.

Do not pay the frozen-router cost until the multi-party scenario is real.

---

## 10. Build order (suggested)

1. Polyglot Dockerfile (Python 3.11 + Node, builds `dist/`, includes the generator).
2. FastMCP server skeleton + bearer-auth middleware + `streamable-http` run on `$PORT`.
3. `route_context`: clone → generate → route → shape response (the §3/§5 chain).
4. Honest-failure surface (§6) + response-size discipline (§7).
5. Resource caps + allowlist (§8).
6. Acceptance: from this chat, connect to the Render URL and route a real committed Python
   repo; confirm receipt `verified: true` and that a repo with an unlisted dependency
   returns `partial` + suggested modules.
