# Changelog

## 0.1.0

Phase 1 — Single-project one-shot vertical slice.

- `nightcrew init`: scaffolds `.nightcrew/` (config, crew.md, plans dirs,
  questions/qa), patches `.gitignore`, registers the project globally.
- Provider seam with two adapters: **Codex SDK** (subscription auth, streamed
  typed events, overall + idle watchdogs, quota detection) and a scripted
  **fake** adapter for deterministic tests.
- Worktree-first execution: one branch + worktree per plan, bootstrap steps,
  session resume within a plan, scoped auto-commit at iteration end.
- Write-scope guard: control ops may only touch `.nightcrew/`; protected paths
  (`config.yaml`, `crew.md`, `.git`) are reverted on violation, everywhere.
- Deterministic verify profiles; failures downgrade the next iteration to
  `repair` with the failing step output embedded in the prompt.
- Promotion pipeline with a live review seam (NullReviewer until Phase 2):
  verify → review → merge-back (`auto`/`branch` policies), plan lifecycle
  active → completed, worktree/branch cleanup, typed `merge_conflict` repair.
- CLI: `run` (one iteration, auto-resolved operation), `status`, `plan
  list/show`.
- Synthetic e2e suite on temp git repos: green path, session continuity,
  verify→repair, idle/overall timeouts, merge-conflict repair, idle BACKLOG,
  control-scope violations, protected-path enforcement.

## 0.0.2

Phase 0 — Foundations.

- TypeScript strict + ESM scaffolding on Node >= 22.
- Tooling: biome (lint + format), vitest, tsup, changesets.
- GitHub Actions CI matrix (ubuntu + macos): typecheck, lint, test, build.
- Zod schema for `.nightcrew/config.yaml` (strict; unknown keys fail loudly).
- Core domain types: operations, typed failures, runtime state, history records.
- CLI skeleton with `nightcrew` and `crew` bins.

## 0.0.1

- Name reservation and project home.
