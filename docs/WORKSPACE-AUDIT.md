# Horos + ATG + Mneme workspace audit

Audit date: 2026-09-12. First deployment target: private/self-hosted, single
operator. Detailed evidence is in `HOROS-AUDIT.md`, `../../ATG/docs/ATG-AUDIT.md`,
and `../../Mneme-/docs/LOCAL-SETUP.md`.

## Vision alignment

| Pain point | Current responsibility | Verified behavior | Honest limit |
| --- | --- | --- | --- |
| Context loss and forgetting | Mneme stores durable prompts/decisions; ATG saves resumable work. | Local memory survived service restart with the same ID/hash; a fresh ATG store reopened an integrity-valid checkpoint. | Agents must explicitly save and retrieve scoped records. This is not universal chat interception. |
| Hallucinations | Horos proves the input selection and exposes unresolved coverage. Mneme preserves attributed evidence and corrections. | Receipt replay, source hashes, graph provenance and optional signer pinning fail closed. | None of these prove an answer is factually true. Answer-level citation/evidence grading remains a separate product gap. |
| Context pollution | Horos ranks graph-relevant files and emits exclusions/gaps; the local pack enforces a complete-output byte cap. | Seven curated tasks found all expected anchor files. The strict Horos profile reduced three packs from 14–27 files to at most 12 and 36–39 KB. | Seven curated tasks are a smoke test. Precision, recall and large-monorepo behavior need a real benchmark corpus. |
| Cost and latency | ATG evaluates supplied rate/context headroom; Horos reduces delivered source. | Unknown/exhausted/overflow inputs paused, a fitting input proceeded, and the small local pack evaluation completed in hundreds of milliseconds per graph/pack stage. | ATG is advisory and caller-fed. Dollar cost, live telemetry, provider cache effects, and production p95/p99 latency are not measured. |

## End-to-end flow

1. Retrieve `workspace/horos-atg-mneme/latest` from local Mneme and only the linked
   records needed for the task.
2. Generate a Horos graph and create a strict context pack. Treat `partial` as a
   review gate; inspect unresolved symbols, exclusions and coverage.
3. Check ATG usage and context headroom using host-supplied counts. Pause and save
   a checkpoint before the reserved recovery space is consumed.
4. Execute the task using the selected source as untrusted evidence. Record source
   references and verify factual claims separately.
5. Save the exact user prompt, decisions, receipt hash, tests/results, blockers and
   next action in Mneme; link the memory key in the ATG checkpoint.

## Cross-project acceptance

Run from Horos after building TypeScript:

```powershell
python scripts/workspace_eval.py --with-mneme
```

On 2026-09-12 the evaluation passed all seven anchor cases, the synthetic ATG
policy matrix, checkpoint reopen/integrity, and Mneme store/get/integrity. Latest
evidence: `.local/audit/eval-20260912T154436Z-5b017c/report.json`.

This makes the private workflow concrete and usable. The larger vision still
needs an answer-grounding evaluator, benchmark datasets, live provider telemetry,
and load/chaos testing before making broad public-production claims.
