---
id: 2026-07-03-config-json-schema
title: Add config JSON schema
created: 2026-07-03
parallel: false
---

## Goal
Close the editor-autocomplete seam for `.nightcrew/config.yaml` by generating a committed JSON Schema from the existing zod config schema, wiring it into the init template, and protecting it with a sync test so future config changes update the schema deliberately.

## Acceptance
- [x] `schema/config.schema.json` is generated from the zod config schema with zod v4 `z.toJSONSchema`, committed, and reproducible through an `npm run schema` script without new dependencies.
- [x] A focused test regenerates the schema and fails when the committed schema is out of sync.
- [x] `nightcrew init` emits a config template beginning with a `# yaml-language-server: $schema=` comment pointing at the raw GitHub URL for the committed schema.
- [x] `CHANGELOG.md` records the landed change under `## Unreleased`.

## Steps
1. Locate the existing config zod schema and init template path, then identify the package script and test conventions already in use.
2. Add a schema generation script that calls zod v4 `z.toJSONSchema` and writes `schema/config.schema.json`.
3. Wire `npm run schema` into `package.json`, run it once, and commit the generated schema file.
4. Update the `nightcrew init` config template to include the yaml-language-server schema comment.
5. Add a focused schema sync test plus any init-template assertion needed for the schema comment.
6. Update `CHANGELOG.md` under `## Unreleased` and run the relevant tests plus Biome checks.
