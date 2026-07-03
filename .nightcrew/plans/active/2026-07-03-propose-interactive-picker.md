---
id: 2026-07-03-propose-interactive-picker
title: Add propose picker review
created: 2026-07-03
parallel: false
---

## Goal
Close the review gap for generated proposal artifacts by adding the authorized TTY checkbox picker and stored-proposal review flow, reusing the existing propose approval/archive path so interactive and non-interactive selections behave identically.

## Acceptance
- [ ] `nightcrew propose "<goal>"` opens a `@clack/prompts` checkbox picker only when stdout is a TTY; selected items append through the same crew.md merge and proposal archive path as `propose select`.
- [ ] `nightcrew propose review [--latest|<file>]` loads a stored proposal, supports the same interactive picker, and aborting or selecting nothing makes no crew.md changes.
- [ ] Non-TTY generation and review print numbered proposal items plus a hint to use `propose select --ids`, without attempting raw terminal interaction.
- [ ] Tests cover selection/merge reuse and the non-TTY fallback while leaving the raw TTY event loop untested.

## Steps
1. Inspect the completed propose workflow implementation, CLI command structure, and existing proposal tests to identify the approval/archive seam to reuse.
2. Add a small reusable proposal selection helper that can render numbered non-TTY output or call `@clack/prompts` for TTY checkbox selection.
3. Wire generation completion and `propose review [--latest|<file>]` through the helper, ensuring selected ids flow into the existing append-and-archive path.
4. Add focused tests for stored proposal loading, no-selection behavior, merge/archive reuse, and non-TTY fallback output.
5. Run the relevant vitest and lint/type checks, then update CHANGELOG under `## Unreleased`.
