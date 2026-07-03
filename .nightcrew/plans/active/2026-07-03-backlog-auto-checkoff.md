---
id: 2026-07-03-backlog-auto-checkoff
title: Add BACKLOG auto-checkoff
created: 2026-07-03
parallel: false
---

## Goal
Close the deterministic link between landed plans and the operator BACKLOG: plans can optionally declare the exact BACKLOG first line they cover, review validates that mapping, and the runner marks a uniquely matched unchecked item complete only after a successful merge. This keeps `.nightcrew/crew.md` accurate without expanding agent write authority.

## Acceptance
- [ ] Plan frontmatter accepts an additive optional `backlog` field containing the exact BACKLOG first-line text, and plan review validates that it maps to one unchecked crew item.
- [ ] After a successful merge, runner-owned deterministic code changes only the uniquely matched `- [ ]` BACKLOG line to `- [x]`.
- [ ] Missing or non-unique matches produce a history note and leave `.nightcrew/crew.md` unchanged.
- [ ] Agent write restrictions remain unchanged, `CHANGELOG.md` is updated under `## Unreleased`, and focused tests cover schema/review, successful checkoff, and no-op note paths.

## Steps
1. Extend the plan schema and review validation to accept and verify the optional `backlog` mapping without changing existing plan behavior.
2. Add a runner-side helper that parses `.nightcrew/crew.md`, performs the unique unchecked-line checkoff after merge success, and records a note instead of editing on ambiguous matches.
3. Wire the helper into the successful merge completion path while preserving current agent write restrictions.
4. Add focused tests for schema/review validation, successful checkoff, no-match and multi-match no-op behavior, plus the changelog entry.
