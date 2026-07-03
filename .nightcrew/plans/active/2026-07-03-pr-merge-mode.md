---
id: 2026-07-03-pr-merge-mode
title: Add PR merge mode
created: 2026-07-03
parallel: false
---

## Goal
Close the release-control seam by adding an additive `git.mergeMode: merge | pr` path so operators can have nightcrew publish completed plans as GitHub pull requests instead of merging locally, while keeping the existing merge behavior as the default and preserving deterministic repair handling when push or PR creation fails.

## Acceptance
- [ ] Config parsing accepts `git.mergeMode` with default `merge`, and `nightcrew doctor` requires `gh` only when `pr` mode is configured.
- [ ] In `pr` mode, a green completed plan pushes `nightcrew/<plan-id>`, opens a PR against the base branch with title and acceptance summary, records the PR URL in history notes, completes the plan, and cleans up the worktree.
- [ ] Push or PR creation failure becomes a typed repair without landing or losing the plan, with tests covering the success and failure paths.

## Steps
1. Extend config schema, defaults, doctor checks, and docs/changelog for `git.mergeMode`.
2. Add deterministic runner support for the `pr` landing path using `git` and `gh` CLI boundaries already used elsewhere.
3. Persist PR URLs in history notes and ensure completed plan/worktree cleanup matches the existing merge flow.
4. Add focused tests for config defaults, conditional doctor behavior, PR-mode success, and typed repair on push or PR failure.
