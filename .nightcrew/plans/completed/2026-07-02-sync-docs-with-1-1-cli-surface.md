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

- [x] README command table lists `nightcrew doctor`, `nightcrew plan add`, and
      `crew report` with one-line descriptions consistent with `--help` output.
- [x] README quickstart mentions `nightcrew doctor` as the first-run sanity
      check right after `nightcrew init`.
- [x] `docs/concepts.md` "morning" flow mentions the per-plan breakdown now in
      `nightcrew report` (one sentence is enough).
- [x] No changes outside README.md and docs/.

## Steps

1. [x] Run `node dist/cli.js --help`, `plan --help`, `doctor --help`, and
   `crew --help` to capture the real command surface.
2. [x] Update README.md command table + quickstart.
3. [x] Add the per-plan breakdown sentence to docs/concepts.md.
