---
id: 2026-07-03-proposal-console-support
title: Add proposal console approval
created: 2026-07-03
parallel: false
---

## Goal
Close the console seam for proposals so operators can review pending proposal items from the project detail page and, when actions are enabled, approve selected items through the same append-and-archive path already used by the CLI workflow.

## Acceptance
- [ ] The project detail page lists pending proposal items with title, backlog-ready body, source lens, and selectable checkboxes.
- [ ] With `--actions` enabled, approving selected proposal item ids POSTs to a new endpoint that appends those items to `.nightcrew/crew.md` and archives the proposal artifact through the shared approval path.
- [ ] Without `--actions`, proposal items render read-only and the approval endpoint returns 404.
- [ ] Tests cover pending proposal rendering, action-enabled approval, action-disabled 404 behavior, and reuse of the shared append/archive selection logic.

## Steps
1. Locate the console project detail route, action gating, proposal storage helpers, and existing CLI approval code path.
2. Add a shared server-side approval helper if needed, preserving the exact CLI append/archive semantics.
3. Render pending proposal items on the project detail page with disabled or enabled selection controls based on actions mode.
4. Add the approval endpoint behind the existing actions gate and wire it to the shared approval helper.
5. Add focused tests for rendering, endpoint behavior, action gating, and archive/append effects.
