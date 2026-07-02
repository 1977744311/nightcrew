---
id: 2026-07-02-sync-docs-with-1-1-cli-surface
title: Sync docs with 1.1 CLI surface
created: 2026-07-02
parallel: false
---

## Goal

The 1.1 cycle added `nightcrew doctor`, `nightcrew plan add <title>`,
`crew report`, and a per-plan breakdown inside `nightcrew report`. The README
command table and quickstart still describe the 1.0 surface. Bring user-facing
docs in line with the shipped CLI, without inventing features.

## Acceptance

- [ ] README command table lists `nightcrew doctor`, `nightcrew plan add`, and
      `crew report` with one-line descriptions consistent with `--help` output.
- [ ] README quickstart mentions `nightcrew doctor` as the first-run sanity
      check right after `nightcrew init`.
- [ ] `docs/concepts.md` "morning" flow mentions the per-plan breakdown now in
      `nightcrew report` (one sentence is enough).
- [ ] No changes outside README.md and docs/.

## Steps

1. Run `node dist/cli.js --help`, `plan --help`, `doctor --help`, and
   `crew --help` to capture the real command surface.
2. Update README.md command table + quickstart.
3. Add the per-plan breakdown sentence to docs/concepts.md.
