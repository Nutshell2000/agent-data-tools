// JSON Schema for a tool's result, derived from its published output example.
// Directories (Coinbase Bazaar, x402scan, openapi.json) rank listings higher when the
// output is described field by field rather than as a bare object.

type Schema = Record<string, unknown>;

/** Field types and nesting from the example. Nothing is marked required and nulls accept any type, so real results never fail it. */
export function schemaFromExample(value: unknown): Schema {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value)) return { type: "array", items: value.length ? schemaFromExample(value[0]) : {} };
  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, schemaFromExample(v)])),
      };
    default:
      return {};
  }
}
