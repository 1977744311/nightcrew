---
id: 2026-07-02-report-per-plan-breakdown
title: Add report per-plan breakdown
created: 2026-07-02
parallel: false
---

## Goal
Close the visibility gap in `nightcrew report` by showing how each plan contributed to the nightly summary, so operators can see where iterations and token budget went without losing the existing top-level report shape.

## Acceptance
- [x] `nightcrew report` data includes a per-plan breakdown with iterations, tokens, and landed status while preserving the existing summary fields.
- [x] Human-readable report output renders a per-plan table, and `--json` includes the same per-plan data.
- [x] Focused tests cover the new report data and rendered output.

## Steps
1. Inspect the existing report data model, renderer, and tests to identify the smallest additive shape for per-plan metrics.
2. Extend report aggregation to collect per-plan iterations, tokens, and landed status without changing existing summary semantics.
3. Render the per-plan breakdown in text and JSON report paths using existing CLI output conventions.
4. Add or update focused tests for aggregation and output, then run the relevant test and formatting checks.
