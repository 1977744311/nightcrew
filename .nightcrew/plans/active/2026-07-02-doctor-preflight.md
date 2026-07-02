---
id: 2026-07-02-doctor-preflight
title: Add doctor preflight
created: 2026-07-02
parallel: false
---

## Goal
Add a `nightcrew doctor` preflight command that gives operators one reliable pass/fail view of the local runtime, git repository, project config, registry registration, and daemon lock state before unattended work begins.

## Acceptance
- [x] `nightcrew doctor` checks node >= 20, git availability with repo detection, `.nightcrew/config.yaml` schema parsing, base branch existence, non-empty bootstrap and verify commands, global registry registration, and stale daemon lock status.
- [x] The command prints a pass/fail table using existing CLI log/color helpers and exits 0 only when every check passes.
- [x] Focused tests cover passing and failing checks, duplicate failure reporting where relevant, and the exit-code contract.
- [x] `CHANGELOG.md` gains an `## Unreleased` entry describing the new command.

## Steps
1. Inspect existing CLI command registration, config schema loading, registry access, daemon lock handling, logging helpers, and related tests.
2. Implement a small doctor check runner that returns structured check results without printing directly.
3. Wire `nightcrew doctor` into the CLI, render the pass/fail table, and preserve the documented exit-code behavior.
4. Add focused vitest coverage for success, representative failures, and output shape.
5. Update `CHANGELOG.md` under `## Unreleased`.
