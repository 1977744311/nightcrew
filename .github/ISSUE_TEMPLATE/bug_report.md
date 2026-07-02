---
name: Bug report
about: Something misbehaved — ideally with the ledger to prove it
labels: bug
---

## What happened

<!-- One or two sentences. -->

## Evidence

nightcrew keeps a ledger precisely for this. Please attach what applies:

- the `iteration.finished` line(s) from `.nightcrew/runtime/events.jsonl`
- the matching record from `.nightcrew/runtime/history.jsonl`
- `.nightcrew/runtime/logs/<iteration-id>.log` for the failing iteration
- your `.nightcrew/config.yaml` (redact anything private)

## Expected

<!-- What should have happened instead. -->

## Environment

- nightcrew version (`nightcrew --version`):
- Node version (`node --version`):
- OS:
- Provider: codex / fake
