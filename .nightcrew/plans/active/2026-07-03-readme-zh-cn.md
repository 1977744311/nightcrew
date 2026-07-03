---
id: 2026-07-03-readme-zh-cn
title: Add Chinese README
created: 2026-07-03
parallel: false
---

## Goal
Add the authorized localized README surface and package guardrails so Chinese readers get a maintained README without allowing Han-script text to leak into source, docs, tests, package metadata, changelog text, or CLI output.

## Acceptance
- [ ] `README.zh-CN.md` mirrors the current `README.md` structure, commands, config keys, links, status, and license details, with reciprocal language links between both README files.
- [ ] Package publishing metadata includes `README.zh-CN.md`, `CHANGELOG.md` has an `## Unreleased` entry, and focused tests verify Han-script placement plus package inclusion.
- [ ] Relevant tests and formatting/type checks pass under the repo's existing TypeScript, Biome, and vitest workflow.

## Steps
1. Review `README.md`, package publishing metadata, changelog conventions, and nearby tests for text-file/package assertions.
2. Add `README.zh-CN.md`, the English README link, package metadata inclusion, and the `## Unreleased` changelog entry.
3. Add focused tests for Han-script restrictions and package inclusion, then run the targeted and relevant full checks.
