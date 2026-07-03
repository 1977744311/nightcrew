---
id: 2026-07-03-launch-writeup-draft
title: Draft launch write-up
created: 2026-07-03
parallel: false
---

## Goal
Create the launch write-up draft at `docs/launch.md`, closing the currently missing public narrative for nightcrew's unattended-loop design while keeping every claim grounded in the authorized project sources instead of invented metrics or anecdotes.

## Acceptance
- [x] `docs/launch.md` exists with the requested structure: failure modes, nightcrew's guard/review/worktree answers, and the dogfood story for versions 1.1-1.3.
- [x] Every substantive claim in the draft is grounded only in `ROADMAP.md`, `docs/concepts.md`, or `CHANGELOG.md`, with operator-voice gaps marked as `<!-- operator: ... -->` comments.
- [x] No product code is changed; any required documentation bookkeeping, including `CHANGELOG.md` under `## Unreleased`, is included.

## Steps
1. Read `ROADMAP.md`, `docs/concepts.md`, and `CHANGELOG.md` to extract only supported launch-write-up claims.
2. Draft `docs/launch.md` with the authorized structure and explicit operator comments for unsupported voice or anecdote gaps.
3. Add the required `CHANGELOG.md` Unreleased entry and verify the diff contains documentation changes only.
