---
id: 2026-07-03-codex-provider-preflight
title: Add Codex provider preflight
created: 2026-07-03
parallel: false
---

## Goal
Close the preflight seam between environment validation and the Codex-only runtime path by making doctor, loop, and crew start verify that a configured Codex provider can authenticate before spending an unattended iteration, while fake provider flows report skip for tests and local demos.

## Acceptance
- [x] `nightcrew doctor` reports a provider check that passes for configured Codex credentials, fails with a clear `codex login` hint when Codex auth is missing, and reports skip for the fake provider without changing existing check behavior.
- [x] `nightcrew loop` and `crew start` run the same provider preflight before starting work, fail fast for missing Codex auth, and keep fake provider startup testable with deterministic coverage.
- [x] Tests cover doctor output/status, loop/start fail-fast behavior, fake-provider skip, and the auth detection path without requiring real Codex credentials.

## Steps
1. Inventory current doctor checks, provider config loading, loop/start entry points, and existing fake-provider test seams.
2. Add a shared provider preflight helper that reads configured provider mode and verifies Codex auth by readable `~/.codex/auth.json` or an equivalent lightweight SDK probe.
3. Wire the helper into `nightcrew doctor`, `nightcrew loop`, and `crew start` with English output and typed startup failure behavior.
4. Add focused tests for Codex success, missing-auth failure, fake-provider skip, and startup fail-fast behavior, then update the changelog under `## Unreleased`.
