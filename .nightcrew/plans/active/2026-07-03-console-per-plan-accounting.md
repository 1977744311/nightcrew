---
id: 2026-07-03-console-per-plan-accounting
title: Expose console per-plan metrics
created: 2026-07-03
parallel: false
---

## Goal
Close the gap between `nightcrew report` per-plan accounting and the console project detail page by moving plan history aggregation into one shared model, then exposing and rendering that model consistently in report output and console detail data.

## Acceptance
- [ ] A shared aggregation module returns plan id, title, iterations, total tokens, durationMs, and landed/pending status, and `nightcrew report` uses it without changing the existing summary contract.
- [ ] `src/console/data.ts` exposes stable per-plan metrics in project detail JSON, and the project detail HTML renders a per-plan table with token totals and human-readable duration while preserving existing summary, proposals, token curve, and history table.
- [ ] Tests cover the aggregation module, console detail JSON shape, and the HTML rendering path.

## Steps
1. Locate the current report-only per-plan aggregation and extract it into a shared module with focused unit coverage.
2. Replace report-local aggregation with the shared model and verify existing report behavior remains intact.
3. Wire the shared model into console project detail data and add JSON shape tests.
4. Render the per-plan table on the project detail page and add HTML rendering coverage.
