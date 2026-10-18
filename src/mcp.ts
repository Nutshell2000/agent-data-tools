import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { schemaFromExample } from "./lib/output-schema";
import { createPaymentWrapper } from "@x402/mcp";
import type { Context } from "hono";
import { z } from "zod";
import { ENDPOINTS, MCP_BUNDLES, MCP_SERVER_VERSION, mcpBundleTools, SERVICE_ID, SERVICE_NAME, type Endpoint, type EndpointPath } from "./discovery";
import { HttpError, type Env } from "./lib/env";
import { resourceServer } from "./lib/payments";
import { paymentNetworks } from "./lib/networks";
import { withMcpRevenue } from "./lib/revenue";
import { activeTrace, markStage, withToolTrace } from "./lib/funnel";
import { protocolTool, toolAnnotations, toolDescription, toolInputShape, toolName } from "./mcp-contract";
import { TOOLS } from "./tools";

type Args = Record<string, unknown>;
type Accepts = Parameters<typeof createPaymentWrapper>[1]["accepts"];

export { toolName } from "./mcp-contract";

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
async function runTool(env: Env, e: Endpoint & { path: EndpointPath }, args: Args) {
  try {
    const path: EndpointPath = e.path;
    const result = await TOOLS[path](env, (name) => (args[name] === undefined ? undefined : String(args[name])));
    const { imageBase64: _image, ...structuredContent } = result as Record<string, unknown>;
    return { content: toContent(result), structuredContent };
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    return { isError: true, content: [{ type: "text", text: err instanceof HttpError ? err.message : "internal error" }], ...(err instanceof HttpError && err.code ? { structuredContent: { error: err.message, code: err.code } } : {}) };
  }
}

// Publish only completed state. A pending initialization must stay request-local.
let payments: { server: ReturnType<typeof resourceServer>; terms: Record<string, Accepts> } | undefined;

async function paymentState(env: Env) {
  if (payments) return payments;
  const server = resourceServer(env);
  await server.initialize();
  const built: Record<string, Accepts> = {};
  for (const e of ENDPOINTS) {
    // One requirement per accepted network; Base stays first so existing clients see the same default.
    const options = [];
    for (const network of paymentNetworks(env)) {
      options.push(...await server.buildPaymentRequirements({ scheme: "exact", network, payTo: env.PAY_TO, price: e.price }));
    }
    built[e.path] = options as Accepts;
  }
  return (payments = { server, terms: built });
}

// Each tool's payment wrapper depends only on the per-isolate payment server and the tool's fixed
// terms, so build it once per isolate instead of on every MCP request (the whole catalog).
const wrappers = new Map<string, ReturnType<typeof createPaymentWrapper>>();
function paymentWrapperFor(e: Endpoint, payment: NonNullable<typeof payments>) {
  let factory = wrappers.get(e.path);
  if (!factory) {
    const required = Object.entries(e.params).filter(([, p]) => p.required).map(([name]) => name);
    factory = createPaymentWrapper(payment.server, {
      accepts: payment.terms[e.path as EndpointPath],
      resource: {
        // The wrapper can't see the tool's name, so the default URL would be a placeholder.
        // The receipt ledger reads the catalog path back from this URL, so keep the real path.
        url: `mcp://tool${e.path}`,
        description: e.description,
        mimeType: "application/json",
        serviceName: SERVICE_NAME,
        tags: [...e.tags],
      },
      extensions: declareDiscoveryExtension({
        toolName: toolName(e),
        description: e.description,
        inputSchema: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(e.params).map(([name, p]) => [name, { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) }]),
          ),
          required,
        },
        output: { example: e.outputExample, schema: schemaFromExample(e.outputExample) },
      }),
    });
    wrappers.set(e.path, factory);
  }
  return factory;
}
const inputShapes = new Map<string, ReturnType<typeof toolInputShape>>();
const listedTools = new Map<string, ReturnType<typeof protocolTool>[]>();

/** Stateless MCP endpoint: every paid HTTP endpoint is also a paid tool. A bundle serves one catalog section. */
export async function handleMcp(c: Context<{ Bindings: Env }>, bundle = "") {
  const endpoints = bundle ? mcpBundleTools(bundle) : ENDPOINTS;
  if (!endpoints) return c.json({ error: `unknown MCP bundle; use one of: ${Object.keys(MCP_BUNDLES).join(", ")}` }, 404);
  const env = c.env;
  const paid = env.PAYWALL !== "off";
  const payment = paid ? await paymentState(env) : undefined;
  const mcp = new McpServer({ name: SERVICE_ID, title: SERVICE_NAME, version: MCP_SERVER_VERSION });

  for (const e of endpoints) {
    const handler = (args: Args) => runTool(env, e, args);
    const callback = payment
      ? (() => {
          const wrapped = paymentWrapperFor(e, payment)(handler as never) as (args: Args, extra: unknown) => Promise<{
            isError?: boolean;
            _meta?: Record<string, unknown>;
          }>;
          return withMcpRevenue(
            e.path,
            wrapped,
            () => env.METRICS?.get(env.METRICS.idFromName("global")),
            (promise) => c.executionCtx.waitUntil(promise),
          );
        })()
      : handler;
    const tracked = async (args: Args, extra: unknown) => withToolTrace(e.path, async () => {
      const meta = (extra as { _meta?: Record<string, unknown> })?._meta;
      const paidAttempt = Boolean(meta?.["x402/payment"]);
      if (paidAttempt) markStage("attempt");
      try {
        const result = await (callback as (args: Args, extra: unknown) => Promise<{ isError?: boolean; structuredContent?: { accepts?: unknown[] }; _meta?: Record<string, unknown> }>)(args, extra);
        const trace = activeTrace();
        if (!paidAttempt && result.isError && result.structuredContent?.accepts) markStage("quote");
        if (trace?.stages.has("settled") && !result.isError) markStage("completed");
        else if (result.isError && trace?.stages.has("verified") && !trace.stages.has("settlement_failed")) markStage("execution_failed");
        // SDK clients validate any structuredContent, including isError responses.
        // Keep failure/quote JSON in text content so it is not mistaken for a successful result.
        const response = result as typeof result & {content?: unknown[]};
        if ("outputSchema" in e && response.isError && response.structuredContent) {
          const {structuredContent, ...errorResult} = response;
          return {...errorResult, content:[{type:"text",text:JSON.stringify(structuredContent)}], _meta:{...response._meta,requestId:trace?.requestId}};
        }
        return { ...result, _meta: { ...result._meta, requestId: trace?.requestId } };
      } catch (error) {
        throw error;
      }
    });
    mcp.tool(
      toolName(e),
      toolDescription(e),
      inputShapes.get(e.path) ?? (inputShapes.set(e.path, toolInputShape(e, z)), inputShapes.get(e.path)!),
      toolAnnotations,
      tracked as never,
    );
  }

  // SDK Zod conversion cannot represent the existing oneOf/not output contract.
  // Advertise it verbatim; TOOLS validates before settlement, rather than after the SDK handler.
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: listedTools.get(bundle) ?? (listedTools.set(bundle, endpoints.map(protocolTool)), listedTools.get(bundle)!)}));
  const transport = new StreamableHTTPTransport();
  await mcp.connect(transport);
  return (await transport.handleRequest(c)) ?? c.body(null, 204);
}
