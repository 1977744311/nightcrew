---
id: 2026-07-03-init-assist
title: Add init assist drafting
created: 2026-07-03
parallel: false
---

## Goal
Close the initialization guidance seam by adding an opt-in `nightcrew init --assist` path that inspects a repository with a read-only Codex pass, drafts the initial config and crew rules, and preserves the existing offline `init` behavior for unattended or non-assisted setup.

## Acceptance
- [ ] `nightcrew init --assist` runs a read-only provider pass that drafts verify profile steps, bootstrap command, baseBranch, and 2-3 initial crew rules, then prints the draft before any write.
- [ ] TTY usage writes the assisted draft only after explicit operator confirmation, while non-TTY usage only prints the draft and bare `nightcrew init` stays offline and unchanged.
- [ ] Fake-provider tests cover the assisted draft path, non-TTY print-only behavior, confirmation gating, and no regression to bare init behavior.
- [ ] `CHANGELOG.md` is updated under `## Unreleased` with English product-facing text.

## Steps
1. Inspect the existing init command, config template generation, provider routing, and fake-provider test helpers.
2. Add the `--assist` command path with a read-only Codex prompt that asks for config draft fields and initial crew rules using existing structured provider patterns.
3. Implement TTY confirmation and non-TTY print-only behavior without changing the default offline init flow.
4. Add focused tests for fake-provider assistance, write gating, non-TTY behavior, and unchanged bare init behavior.
5. Run the targeted test suite plus formatting/type checks required by the repo, then update the changelog.
