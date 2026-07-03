---
id: 2026-07-03-propose-language-mirroring
title: Mirror proposal language
created: 2026-07-03
parallel: false
---

## Goal
Close the proposal prompt seam so generated candidate titles, bodies, and rationales follow the operator's language without adding detection code or changing CLI strings, including refine prompts that should follow the feedback language.

## Acceptance
- [x] Proposal generation prompts explicitly instruct each lens to write candidate title, body, and rationale in the language of the goal text while preserving BACKLOG checkbox formatting rules.
- [x] Proposal refine prompts explicitly instruct each rerun lens to follow the language of the operator feedback, and tests assert both prompt instructions are present.

## Steps
1. Inspect proposal prompt construction for initial and refine flows, add language-mirroring instructions in the existing prompt path, cover them with focused prompt tests, and update CHANGELOG under Unreleased.
