## What

<!-- One or two sentences: what does this PR change? -->

## Why

<!-- What problem does it solve, or what gap does it close? Link to the issue if one exists. -->

## Spec section

<!-- Which section of SPEC-v0.1.md, SPEC-mcp-server-v0.md, or a DECISIONS file governs this change? If the change is not covered by any spec section, say so explicitly. -->

## Test evidence

<!-- Paste the relevant test output (npm test / python3 -m unittest) showing the new or changed behavior is covered. A "it passes" with no output is not enough. -->

```
<test output here>
```

## Checklist

- [ ] The receipt this change produces replays under `horos verify` (or this PR does not affect receipt production).
- [ ] Any spec ambiguity introduced or resolved is recorded in the relevant `DECISIONS*.md`.
- [ ] TypeScript: no new `as any`, no suppressed type errors.
- [ ] All hashes use `src/canonical/cjson.ts`, not ad-hoc `JSON.stringify`.
