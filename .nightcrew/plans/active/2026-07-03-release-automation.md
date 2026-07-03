---
id: 2026-07-03-release-automation
title: Add release automation
created: 2026-07-03
parallel: false
---

## Goal
Close the release-operations seam by adding the authorized changesets version-PR and npm provenance publish path, while preserving the operator-owned release mechanics: no version bumps, no tag changes, no existing CI rewrites, and clear documentation for the required `NPM_TOKEN` secret plus the manual fallback flow.

## Acceptance
- [x] `.github/workflows/release.yml` uses the official changesets action for version PRs and publishes with `npm publish --provenance` using the `NPM_TOKEN` secret, without changing existing CI workflows, version numbers, or git tags.
- [x] `package.json` includes `publishConfig.provenance`, and `CONTRIBUTING.md` documents the secret setup, automated release steps, and the existing manual `npm version` plus tag fallback.
- [x] Focused validation covers the workflow/package/docs contract where practical, and the standard format/type/test checks pass.

## Steps
1. Inspect the existing workflows, release documentation, package publishing metadata, and any changesets setup to avoid altering unrelated release mechanics.
2. Add the changesets release workflow and npm provenance publishing metadata, keeping version numbers and current CI untouched.
3. Update `CONTRIBUTING.md` with operator-owned `NPM_TOKEN` setup, the automated version-PR/publish flow, and the manual fallback.
4. Add focused validation if the repo has a suitable static-test pattern, then run the standard Biome, TypeScript, and vitest checks.
