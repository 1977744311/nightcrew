---
id: 2026-07-02-crew-report
title: Add crew report aggregation
created: 2026-07-02
parallel: false
---

## Goal
Close the reporting seam between single-project `nightcrew report` output and operator-level morning review by adding `crew report`, which aggregates `buildReport` results across every registered project and presents one combined digest with project totals and a grand total.

## Acceptance
- [x] `crew report` loads all registered projects, reuses `buildReport` for each project, and renders per-project landed count, failed count, and token usage plus grand totals.
- [x] `crew report --hours` and `crew report --json` behave consistently with `nightcrew report`, including exit behavior for invalid arguments.
- [x] Tests cover multi-project aggregation, JSON output, hours filtering, and failure handling for an unreadable project report.
- [x] `CHANGELOG.md` is updated under `## Unreleased` when the plan lands.

## Steps
1. [x] Inspect the existing `nightcrew report` CLI path, global registry loading, and `buildReport` return shape to identify reusable seams.
2. [x] Add the `crew report` command wiring with `--hours` and `--json` flags matching `nightcrew report`.
3. [x] Implement the aggregator that iterates registered projects, calls `buildReport` per project, records per-project totals, and computes grand totals.
4. [x] Add text and JSON renderers for the combined digest using existing log and color helpers.
5. [x] Add focused tests for command behavior, aggregation totals, filtering, JSON shape, and partial project failure handling.
6. [x] Update `CHANGELOG.md` under `## Unreleased` and run the relevant test and lint commands.
