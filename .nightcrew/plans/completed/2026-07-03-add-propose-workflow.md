---
id: 2026-07-03-add-propose-workflow
title: Add propose workflow
created: 2026-07-03
parallel: false
---

## Goal
Close the seam between an operator's one-line goal and reviewable BACKLOG candidates by adding the foundational non-interactive `nightcrew propose` workflow now, so later interactive picker and console approval work can reuse one stable proposal artifact, selection, append, and archive path.

## Acceptance
- [x] `nightcrew propose "<goal>"` runs three independent read-only Codex provider research passes using lenses for minimal path, architecture-first, and risk-first, requests structured JSON through `outputSchema`, keeps the fake provider scriptable for tests, and writes one stable-schema proposal artifact with stable item ids under `.nightcrew/proposals/`.
- [x] `routing.propose` is added to config as `light|heavy` with default `light`, and proposal generation honors it without adding any non-Codex provider adapter.
- [x] `nightcrew propose list` shows pending proposals, and `nightcrew propose select --ids 1,3` appends the chosen backlog-ready checkbox bodies verbatim to the `## BACKLOG` section of `.nightcrew/crew.md` before archiving the proposal artifact.
- [x] Tests cover config defaults, fake-provider proposal generation, artifact stability, list/select behavior, archive behavior, and relevant error paths; `CHANGELOG.md` is updated under `## Unreleased`.

## Steps
1. Inventory the existing CLI command, config schema, provider `outputSchema`, reviewer fresh-session, registry, and file-layout patterns needed for propose.
2. Add proposal config/schema/types and helpers for deterministic artifact naming, item ids, pending listing, selected-item merge, and archive movement.
3. Implement `nightcrew propose "<goal>"` to run the three read-only structured research passes and persist one merged proposal artifact.
4. Implement `nightcrew propose list` and `nightcrew propose select --ids` using the shared merge-and-archive helper.
5. Extend the fake provider and add vitest coverage for generation, persistence, selection, archiving, stability, and failures.
6. Update `CHANGELOG.md`, run Biome and the relevant/full vitest suites, and tighten any behavior or tests before landing.
