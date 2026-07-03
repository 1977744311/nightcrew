---
id: 2026-07-03-proposal-picker-preview-pane
title: Add proposal picker preview pane
created: 2026-07-03
parallel: false
---

## Goal
Replace the current TTY proposal picker pre-print with a custom `@clack/core` multiselect that previews the highlighted candidate's full body, lens, and rationale inline, closing the duplicated-reading seam while preserving the existing approval/archive behavior and the non-TTY review output.

## Acceptance
- [ ] TTY `propose` generation and `propose review` render a checkbox picker with a live preview for the highlighted candidate and no duplicated full candidate list before the picker.
- [ ] Space, enter, and cancel semantics stay identical to the existing picker, including append/archive approval flow and zero-selection refine behavior.
- [ ] Non-TTY output remains the existing numbered full-body list with the `propose select --ids` hint.
- [ ] Unit tests cover the preview rendering pure function plus affected selection and fallback behavior; raw TTY event-loop wiring may remain untested.
- [ ] `CHANGELOG.md` is updated under `## Unreleased`.

## Steps
1. Locate the existing proposal picker, pre-picker printing seam, refine zero-selection path, and tests that cover TTY and non-TTY proposal review behavior.
2. Add a pure preview rendering helper for candidate title, body, lens, and rationale, then cover it with focused unit tests.
3. Replace the TTY `@clack/prompts` picker with a custom `@clack/core` multiselect wired to the existing approval and cancel semantics.
4. Remove only the TTY full-candidate pre-print while preserving the non-TTY numbered output and selection hint.
5. Run targeted proposal tests plus the repo's configured checks, then update the changelog entry for the landed behavior.
