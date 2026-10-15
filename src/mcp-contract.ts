import type { Endpoint } from "./endpoints";

export const toolName = (endpoint: Endpoint) => endpoint.path.slice(1);

export const toolDescription = (endpoint: Endpoint) =>
  `${endpoint.description} Costs ${endpoint.price} in USDC on Base per successful call, paid with x402.`;

export const toolInputShape = (endpoint: Endpoint, z: typeof import("zod").z) =>
  Object.fromEntries(
    Object.entries(endpoint.params).map(([name, param]) => {
      const schema = param.enum
        ? z.enum(param.enum)
        : param.type === "integer"
          ? z.number().int()
          : param.type === "number"
            ? z.number()
            : z.string();
      const field = schema.describe(param.description);
      return [name, param.required ? field : field.optional()];
    }),
  );
