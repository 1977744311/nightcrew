# Changelog

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
