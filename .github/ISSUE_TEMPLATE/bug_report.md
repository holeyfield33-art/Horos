---
name: Bug report
about: Something is broken or produces wrong output
labels: bug
---

**Repo type**
<!-- Which producer are you using? -->
- [ ] TypeScript / JavaScript (TS generator + router)
- [ ] Python (`graph-gen-python`)

**What happened**
<!-- A clear description of the incorrect behavior. -->

**Expected behavior**
<!-- What should have happened instead? -->

**Steps to reproduce**

1.
2.
3.

**Task string used**
```
<paste the exact task string you passed to generate/route/verify>
```

**`horos.json` (Python only)**
```json
<paste your horos.json, or "N/A" if TS>
```

**`horos verify` result**
<!-- Run: horos verify <receipt.json> --graph <graph.json> --task "..." -->
- [ ] PASS
- [ ] FAIL — field: `___`, detail: `___`
- [ ] Did not reach verify step

**Versions**
- Horos: <!-- e.g. 0.3.3 -->
- Node: <!-- node --version -->
- Python: <!-- python3 --version, if applicable -->

**Additional context**
<!-- Stack traces, graph snippet, anything else that helps. -->
