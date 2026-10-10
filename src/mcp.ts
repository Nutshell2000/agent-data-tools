import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createPaymentWrapper } from "@x402/mcp";
import type { Context } from "hono";
import { z } from "zod";
import { ENDPOINTS, SERVICE_ID, SERVICE_NAME, type Endpoint } from "./discovery";
import { HttpError, type Env } from "./lib/env";
import { resourceServer } from "./lib/payments";
import { TOOLS } from "./tools";

type Args = Record<string, unknown>;
type Accepts = Parameters<typeof createPaymentWrapper>[1]["accepts"];

export const toolName = (e: Endpoint) => e.path.slice(1);

const inputShape = (e: Endpoint) =>
  Object.fromEntries(
    Object.entries(e.params).map(([name, p]) => {
      const field = (p.type === "integer" ? z.number().int() : z.string()).describe(p.description);
      return [name, p.required ? field : field.optional()];
    }),
  );

/** Images go back as MCP image blocks so clients don't have to parse base64 out of JSON. */
function toContent(value: unknown) {
  const { imageBase64, ...rest } = value as Record<string, unknown>;
  if (typeof imageBase64 !== "string") return [{ type: "text", text: JSON.stringify(value) }];
  return [
    { type: "text", text: JSON.stringify(rest) },
    { type: "image", data: imageBase64, mimeType: String(rest.contentType ?? "image/jpeg") },
  ];
}

/** A failed tool returns isError, which makes the payment wrapper cancel the charge. */
async function runTool(env: Env, e: Endpoint, args: Args) {
  try {
    const result = await TOOLS[e.path](env, (name) => (args[name] === undefined ? undefined : String(args[name])));
    return { content: toContent(result) };
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    return { isError: true, content: [{ type: "text", text: err instanceof HttpError ? err.message : "internal error" }] };
  }
}

// Payment terms per tool are plain data, so they are computed once per isolate.
let accepts: Record<string, Accepts> | undefined;

async function paymentTerms(env: Env) {
  if (accepts) return accepts;
  const server = resourceServer(env);
  await server.initialize();
  const built: Record<string, Accepts> = {};
  for (const e of ENDPOINTS) {
    built[e.path] = await server.buildPaymentRequirements({
      scheme: "exact",
      network: env.NETWORK,
      payTo: env.PAY_TO,
      price: e.price,
    });
  }
  return (accepts = built);
}

/** Stateless MCP endpoint: every paid HTTP endpoint is also a paid tool. */
export async function handleMcp(c: Context<{ Bindings: Env }>) {
  const env = c.env;
  const paid = env.PAYWALL !== "off";
  const terms = paid ? await paymentTerms(env) : undefined;
  const mcp = new McpServer({ name: SERVICE_ID, title: SERVICE_NAME, version: "1.0.0" });

  for (const e of ENDPOINTS) {
    const handler = (args: Args) => runTool(env, e, args);
    const required = Object.entries(e.params)
      .filter(([, p]) => p.required)
      .map(([name]) => name);
    const callback = terms
      ? createPaymentWrapper(resourceServer(env), {
          accepts: terms[e.path],
          resource: {
            // The wrapper can't see the tool's name, so the default URL would be a placeholder.
            url: `mcp://tool/${toolName(e)}`,
            description: e.description,
            mimeType: "application/json",
            serviceName: SERVICE_NAME,
            tags: e.tags,
          },
          extensions: declareDiscoveryExtension({
            toolName: toolName(e),
            description: e.description,
            inputSchema: {
              type: "object",
              properties: Object.fromEntries(
                Object.entries(e.params).map(([name, p]) => [name, { type: p.type, description: p.description }]),
              ),
              required,
            },
            output: { example: e.outputExample },
          }),
        })(handler as never)
      : handler;
    mcp.tool(
      toolName(e),
      `${e.description} Costs ${e.price} in USDC on Base per successful call, paid with x402.`,
      inputShape(e),
      callback as never,
    );
  }

  const transport = new StreamableHTTPTransport();
  await mcp.connect(transport);
  return (await transport.handleRequest(c)) ?? c.body(null, 204);
}
