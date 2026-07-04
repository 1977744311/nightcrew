/**
 * OpenAI structured outputs (behind the Codex adapter's `outputSchema`) are
 * stricter than plain JSON Schema: every object node must set
 * `additionalProperties: false` and its `required` array must list exactly the
 * keys of `properties`. A violating schema fails at the API with
 * `invalid_json_schema` — at 3am, with nothing having exercised the call
 * before. This validator reproduces those constraints deterministically so
 * fakes and tests reject a bad schema before any real call is made.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function structuredOutputSchemaViolations(schema: unknown, path = "$"): string[] {
  if (!isRecord(schema)) return [];
  const violations: string[] = [];

  if (schema.type === "object") {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const keys = Object.keys(properties);
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : null;

    if (schema.additionalProperties !== false) {
      violations.push(`${path}: object must set additionalProperties: false`);
    }
    if (!required) {
      violations.push(`${path}: object must supply a required array`);
    } else {
      for (const key of keys) {
        if (!required.includes(key)) {
          violations.push(`${path}: required must include every property key; missing "${key}"`);
        }
      }
      for (const key of required) {
        if (!keys.includes(key)) {
          violations.push(`${path}: required lists unknown property "${key}"`);
        }
      }
    }
    for (const [key, value] of Object.entries(properties)) {
      violations.push(...structuredOutputSchemaViolations(value, `${path}.${key}`));
    }
  }

  if (isRecord(schema.items) || Array.isArray(schema.items)) {
    const items = Array.isArray(schema.items) ? schema.items : [schema.items];
    for (const item of items) {
      violations.push(...structuredOutputSchemaViolations(item, `${path}[]`));
    }
  }

  for (const combinator of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = schema[combinator];
    if (Array.isArray(branches)) {
      for (const [index, branch] of branches.entries()) {
        violations.push(
          ...structuredOutputSchemaViolations(branch, `${path}.${combinator}[${index}]`),
        );
      }
    }
  }

  return violations;
}

export function assertStructuredOutputSchema(schema: unknown): void {
  const violations = structuredOutputSchemaViolations(schema);
  if (violations.length > 0) {
    throw new Error(`invalid structured-output schema: ${violations.join("; ")}`);
  }
}
