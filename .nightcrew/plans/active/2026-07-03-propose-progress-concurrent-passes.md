---
id: 2026-07-03-propose-progress-concurrent-passes
title: Run propose passes concurrently
created: 2026-07-03
parallel: false
---

## Goal
Close the silent propose-generation seam by running the three independent read-only research lenses concurrently while surfacing live per-lens progress, so operators see work advancing without changing proposal candidate ordering or failure behavior.

## Acceptance
- [x] `nightcrew propose` starts the minimal, architecture, and risk lens passes concurrently and still numbers candidates in fixed lens order: minimal, architecture, risk.
- [x] TTY output shows one live status line per lens, and non-TTY output prints plain start and finish or failure lines.
- [x] Any failed lens still fails the whole command, with tests covering out-of-order completion and the failure path.

## Steps
1. Locate the proposal generation pipeline, lens pass orchestration, and existing TTY/non-TTY output seams.
2. Refactor lens execution to launch all three passes concurrently while collecting results by lens order before candidate numbering.
3. Add progress rendering for TTY and non-TTY modes without changing existing proposal persistence or picker behavior.
4. Add focused tests for stable ordering under out-of-order completion and unchanged command failure semantics when a lens fails.
5. Run the relevant proposal test suite and update `CHANGELOG.md` under `## Unreleased`.
