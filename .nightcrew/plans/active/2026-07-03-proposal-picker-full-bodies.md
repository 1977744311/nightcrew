---
id: 2026-07-03-proposal-picker-full-bodies
title: Show full proposal bodies before picker
created: 2026-07-03
parallel: false
---

## Goal
Close the approval-visibility gap in the proposal TTY flow by printing every candidate's id, title, source lens, and full backlog body before the checkbox picker opens, so an operator can review the exact text that would be appended without changing the existing non-TTY behavior.

## Acceptance
- [x] TTY proposal generation and `nightcrew propose review` both render the full candidate details before invoking the checkbox picker.
- [x] Picker option labels remain short while the non-TTY proposal output remains unchanged.
- [x] Tests cover the pre-picker printing through the injectable prompt seam and confirm existing selection behavior still routes through the same approval path.

## Steps
1. Locate the shared TTY review/picker path used after proposal generation and by `propose review`.
2. Add a prompt-seam print step that renders id, title, lens, and full backlog body for each candidate before opening the checkbox picker.
3. Keep checkbox option labels compact and leave the non-TTY rendering path untouched.
4. Add focused tests around the injectable prompt seam and run the proposal-related test subset.
