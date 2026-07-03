---
id: 2026-07-03-propose-refine
title: Add proposal refinement
created: 2026-07-03
parallel: false
---

## Goal
Close the proposal feedback loop by adding `nightcrew propose refine`, so an operator can regenerate a pending proposal from concrete feedback without hand-editing artifacts or losing lineage from the original research pass.

## Acceptance
- [x] `nightcrew propose refine [<id-or-file>] --feedback "<text>"` defaults to the latest pending proposal, reruns all three proposal lenses with the original goal, previous candidate summaries, and feedback in each prompt, writes a new pending artifact with optional `refinedFrom` and feedback fields, and archives the source artifact.
- [x] In TTY picker flows, zero selections prompt once for optional feedback; empty feedback leaves the proposal pending and unchanged, while non-empty feedback refines and reopens the picker on the new artifact.
- [x] Fake-provider tests cover feedback in rerun prompts, lineage fields, source archival, and zero-selection/no-feedback no-op behavior, with `CHANGELOG.md` updated under `## Unreleased`.

## Steps
1. Inspect the existing propose command, artifact schema, archive/select helpers, picker prompt seam, and fake provider scripting points.
2. Implement additive refine command handling, schema fields, prompt construction, source archiving, and TTY zero-selection feedback flow while preserving existing select/review behavior.
3. Add focused tests for CLI refine, interactive feedback branching, provider prompt contents, artifact lineage, and archive/no-op cases; run the relevant Biome and vitest checks.
