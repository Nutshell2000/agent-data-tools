import { pickFields } from "./lib/fields";
import { mcpClientName } from "./lib/caller";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { apiKeyFrom, isCreditKey } from "./lib/credits";
import { creditCharger, directoryInstructions, mcpInstructions, paymentHint, useFreeCall } from "./lib/credit-routes";
import { FREE_CALLS_PER_CALLER, freeCallNote } from "./lib/free-calls";
import { freeCallsPausedNote } from "./lib/browser-402";
import { mppEnabled } from "./lib/mpp-credits";
import { SERVICE_ICON_URL } from "./endpoints";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createPaymentWrapper } from "@x402/mcp";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { CAPACITY_LIMITED, ENDPOINTS, MCP_BUNDLES, MCP_SERVER_VERSION, mcpBundleTools, SERVICE_ID, SERVICE_NAME, type Endpoint, type EndpointPath } from "./discovery";
import { HttpError, isUpstreamFailure, type Env } from "./lib/env";
import { resourceServer } from "./lib/payments";
import { paymentOptions, priceOn } from "./lib/networks";
import { withMcpRevenue } from "./lib/revenue";
import { queueBatched } from "./lib/metrics-batch";
import { activeTrace, markStage, withToolTrace } from "./lib/funnel";
import { annotationsFor, directoryToolDescription, protocolTool, toolDescription, toolInputShape, toolName } from "./mcp-contract";
import { TOOLS } from "./tools";
import { bazaarInputProperties, builderCodeExtension, exampleInput, listingDescription, listingName, listingOutputSchema, listingTags } from "./lib/bazaar-extension";
import { salesOrdered } from "./lib/discovery-index";
import { EXTRA_CHAIN_PATHS } from "./routes/chain-reads";

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
    const result = pickFields(await TOOLS[path](env, (name) => (args[name] === undefined ? undefined : String(args[name]))), args.only === undefined ? undefined : String(args.only));
    const { imageBase64: _image, ...structuredContent } = result as Record<string, unknown>;
    return { content: toContent(result), structuredContent };
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    return { isError: true, content: [{ type: "text", text: err instanceof HttpError ? err.message : isUpstreamFailure(err) ? "an outside data source did not respond in time; not charged, try again" : "internal error" }], ...(err instanceof HttpError && err.code ? { structuredContent: { error: err.message, code: err.code } } : {}) };
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
    for (const { network, payTo } of paymentOptions(env)) {
      options.push(...await server.buildPaymentRequirements({ scheme: "exact", network, payTo, price: priceOn(network, e.price) }));
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
        description: listingDescription(e),
        mimeType: "application/json",
        serviceName: listingName(e.summary),
        iconUrl: SERVICE_ICON_URL,
        tags: listingTags(e.tags, e.path),
      },
      extensions: {
        ...declareDiscoveryExtension({
          toolName: toolName(e),
          description: e.description,
          // Same schema as the HTTP listing (examples, patterns, the real output schema), so an MCP settlement lists
          // the tool as completely as an HTTP one.
          inputSchema: { type: "object", properties: bazaarInputProperties(e), required },
          // The Bazaar indexes an MCP tool by calling it with this example, as it does an HTTP tool with `input`.
          example: exampleInput(e),
          output: { example: e.outputExample, schema: listingOutputSchema(e) },
        }),
        ...builderCodeExtension(),
      },
    });
    wrappers.set(e.path, factory);
  }
  return factory;
}
/** Tools that generate images or audio with AI models: not offered on the signed-in directory server. */
const GENERATIVE_MEDIA: ReadonlySet<string> = new Set(["/image", "/ai/speech"]);
/** Left out of the ChatGPT plugin server (/mcp/chatgpt) after OpenAI's scan of 26 Oct 2026 flagged them:
 *  raw eth_call runs operations it does not expose one by one; the card-number and PII tools read as
 *  requests for payment-card data; two names read as exaggerated; memory writes are hard-to-reverse changes. */
const DIRECTORY_EXCLUDED: ReadonlySet<string> = new Set([
  "/base/call", "/eth/call", "/arb/call", "/op/call", "/polygon/call",
  "/validate/luhn", "/text/pii", "/mev-simulator", "/liquidity-pool-audit",
  "/memory/set", "/memory/get", "/memory/list", "/memory/delete",
]);
const inputShapes = new Map<string, ReturnType<typeof toolInputShape>>();
const listedTools = new Map<string, ReturnType<typeof protocolTool>[]>();

/** Stateless MCP endpoint: every paid HTTP endpoint is also a paid tool. A bundle serves one catalog section. */
export async function handleMcp(c: Context<{ Bindings: Env }>, bundle = "", urlKey?: string, account?: { key: string | null; sub: string }, directory = false) {
  if (urlKey !== undefined && !isCreditKey(urlKey)) return c.json({ error: "the key in this URL is not a valid API key; copy the connector URL again from your /credits/claim page" }, 401);
  // Stateless server: no server-to-client event stream. A GET would open an SSE stream that never
  // carries anything and hangs until the client gives up (monitors logged these as errors), so answer
  // 405 as the Streamable HTTP spec allows. DELETE (session end) has nothing to end.
  if (c.req.method === "GET" || c.req.method === "DELETE") {
    return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this stateless MCP server has no event stream; send JSON-RPC requests with POST." }, id: null }, 405, { Allow: "POST" });
  }
  const catalog = bundle ? mcpBundleTools(bundle) : ENDPOINTS;
  if (!catalog) return c.json({ error: `unknown MCP bundle; use one of: ${Object.keys(MCP_BUNDLES).join(", ")}` }, 404);
  // The signed-in server is what app directories list; their policy excludes AI generation of images,
  // video and audio, so those two tools stay on the open /mcp and HTTP only.
  // Sales order, as in /discovery/resources: payee and risk checks first, toys last (tools/list and registration).
  // The extra networks' ~200 chain reads (chain-reads.ts EXTRA_CHAINS) are served over HTTP and in the /mcp/chain bundle only:
  // the main and signed-in servers would otherwise list over 500 tools, more than MCP clients handle well.
  const sized = bundle === "chain" ? catalog : catalog.filter((e) => !EXTRA_CHAIN_PATHS.has(e.path));
  const endpoints = salesOrdered(account ? sized.filter((e) => !GENERATIVE_MEDIA.has(e.path) && !(directory && DIRECTORY_EXCLUDED.has(e.path))) : sized);
  // directory: the ChatGPT plugin server (/mcp/chatgpt). Same signed-in tools, but no prices, payment methods, links to
  // our checkout or request ids in what ChatGPT shows (its plugin rules); credits are bought on our site, outside ChatGPT.
  const listKey = account ? `${bundle}#${directory ? "chatgpt" : "account"}` : bundle;
  const env = c.env;
  if (c.req.method === "POST" && env.METRICS) {
    // Which apps connect: counted on initialize only, by the client's self-reported name.
    const client = mcpClientName(await c.req.raw.clone().text());
    if (client) {
      const mode = account ? "account" : urlKey || apiKeyFrom((name) => c.req.header(name)) ? "key" : "open";
      queueBatched(env.METRICS.get(env.METRICS.idFromName("global")), (p) => c.executionCtx.waitUntil(p), (b) => b.mcp.push([client, mode]));
    }
  }
  const paid = env.PAYWALL !== "off";
  // An API key from /credits pays every call in this request with card credits instead of x402,
  // so the x402 facilitator is not needed (or contacted) for it.
  const creditKey = paid ? (account ? account.key ?? undefined : apiKeyFrom((name) => c.req.header(name)) ?? urlKey) : undefined;
  // Free calls follow a signed-in person; anonymous callers are told apart by network address.
  const caller = account ? `sub:${account.sub}` : c.req.header("cf-connecting-ip");
  // x402 terms are prepared only when a tool is actually called, so initialize and tools/list stay fast.
  // Signed-in connectors (app directories) never see crypto payment requests: free calls, then a credit key.
  const x402 = paid && !creditKey && !account;
  const freeOnly = paid && !creditKey && Boolean(account);
  let paymentReady: ReturnType<typeof paymentState> | undefined;
  const payment = () => (paymentReady ??= paymentState(env));
  const origin = new URL(c.req.url).origin;
  const mcp = new McpServer({ name: SERVICE_ID, title: SERVICE_NAME, version: MCP_SERVER_VERSION, websiteUrl: origin, icons: [{ src: `${origin}/logo.png`, mimeType: "image/png", sizes: ["512x512"] }, { src: `${origin}/favicon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }] }, { instructions: directory ? directoryInstructions(Boolean(creditKey), endpoints.length) : mcpInstructions(origin, Boolean(creditKey), endpoints.length, mppEnabled(env), Boolean(account)) });

  for (const e of endpoints) {
    const handler = (args: Args) => runTool(env, e, args);
    const callback = creditKey
      ? (args: Args) => creditCharger(env, creditKey, e.price, origin, directory)(() => handler(args))
      : x402
      ? async (args: Args, extra: unknown) => {
          const wrapped = paymentWrapperFor(e, await payment())(handler as never) as (args: Args, extra: unknown) => Promise<{
            isError?: boolean;
            _meta?: Record<string, unknown>;
          }>;
          return withMcpRevenue(
            e.path,
            wrapped,
            () => env.METRICS?.get(env.METRICS.idFromName("global")),
            (promise) => c.executionCtx.waitUntil(promise),
          )(args, extra);
        }
      : freeOnly
      ? async () => ({ isError: true, content: [{ type: "text", text: directory
          ? (CAPACITY_LIMITED.has(e.path) ? "This tool is not included in this account's free calls, so it is not available on the current plan. Nothing was charged." : "This account's free calls are used up, so this tool is not available on the current plan. Nothing was charged.")
          : CAPACITY_LIMITED.has(e.path)
          ? `This tool is not included in the free calls. To use it, buy credits at ${origin}/credits, then reconnect and sign in with your key.`
          : `The free calls for this account are used up. To continue, buy credits at ${origin}/credits, then reconnect and sign in with your key.` }] })
      : handler;
    const tracked = async (args: Args, extra: unknown) => withToolTrace(e.path, async () => {
      const meta = (extra as { _meta?: Record<string, unknown> })?._meta;
      const paidAttempt = Boolean(meta?.["x402/payment"]);
      if (paidAttempt) markStage("attempt");
      try {
        // An unpaid call from a caller with free calls left runs free (lib/free-calls.ts); a failure gives it back.
        let freePaused = false;
        const free = (x402 || freeOnly) && !paidAttempt && !CAPACITY_LIMITED.has(e.path) ? await useFreeCall(env, caller, () => { freePaused = true; }) : null;
        // Free calls that cannot be counted today are not "used up": a signed-in caller without credits is told when they return.
        if (freePaused && freeOnly && !x402) return { isError: true, content: [{ type: "text" as const, text: directory ? "Free calls are paused until 00:00 UTC because today's free-call capacity is used up. Nothing was charged and no free call was used." : `${freeCallsPausedNote()} Nothing was charged and no free call was used.` }] };
        const result = free
          ? await handler(args) as { isError?: boolean; structuredContent?: { accepts?: unknown[] }; _meta?: Record<string, unknown> }
          : await (callback as (args: Args, extra: unknown) => Promise<{ isError?: boolean; structuredContent?: { accepts?: unknown[] }; _meta?: Record<string, unknown> }>)(args, extra);
        if (free && result.isError) await free.refund();
        else if (free) markStage("free_call");
        else if (creditKey && !result.isError) markStage("credits_call");
        const trace = activeTrace();
        if (!paidAttempt && result.isError && result.structuredContent?.accepts) markStage("quote");
        if (trace?.stages.has("settled") && !result.isError) markStage("completed");
        else if (result.isError && trace?.stages.has("verified") && !trace.stages.has("settlement_failed")) markStage("execution_failed");
        // SDK clients validate any structuredContent, including isError responses.
        // Keep failure/quote JSON in text content so it is not mistaken for a successful result.
        const response = result as typeof result & {content?: unknown[]};
        // A quote: the x402 terms stay first for x402 clients; the plain-language card option follows for
        // agents whose client cannot pay, so they can tell their user how to unlock the tool.
        const hint = !paidAttempt && result.isError && result.structuredContent?.accepts ? [{ type: "text", text: `${freePaused ? `${freeCallsPausedNote()} ` : ""}${paymentHint(origin, e.price, Boolean(account), Boolean(env.STRIPE_READ_KEY))}` }]
          : free && !result.isError ? [{ type: "text", text: directory ? `Free call (${free.left} of ${FREE_CALLS_PER_CALLER} free calls left for this account).` : freeCallNote(free.left, origin) }] : [];
        const requestMeta = directory ? {} : { requestId: trace?.requestId };
        if ("outputSchema" in e && response.isError && response.structuredContent) {
          const {structuredContent, ...errorResult} = response;
          return {...errorResult, content:[{type:"text",text:JSON.stringify(structuredContent)}, ...hint], _meta:{...response._meta,...requestMeta}};
        }
        return { ...result, ...(hint.length ? { content: [...(response.content ?? []), ...hint] } : {}), _meta: { ...result._meta, ...requestMeta } };
      } catch (error) {
        throw error;
      }
    });
    mcp.tool(
      toolName(e),
      directory ? directoryToolDescription(e) : toolDescription(e),
      inputShapes.get(e.path) ?? (inputShapes.set(e.path, toolInputShape(e, z)), inputShapes.get(e.path)!),
      annotationsFor(e.path),
      tracked as never,
    );
  }

  // SDK Zod conversion cannot represent the existing oneOf/not output contract.
  // Advertise it verbatim; TOOLS validates before settlement, rather than after the SDK handler.
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: listedTools.get(listKey) ?? (listedTools.set(listKey, endpoints.map((e) => protocolTool(e, directory))), listedTools.get(listKey)!)}));
  const transport = new StreamableHTTPTransport();
  await mcp.connect(transport);
  try {
    return (await transport.handleRequest(c)) ?? c.body(null, 204);
  } catch (err) {
    // @hono/mcp rejects transport problems (an unsupported MCP-Protocol-Version, a wrong Accept header) with an
    // HTTPException that carries its JSON-RPC answer; app.onError turned it into a 500, so health probes sending
    // the 2026-07-28 version logged us as broken. Pass the answer on, with the spec's 400 for an unknown version
    // (the library says 404, which clients read as an expired session).
    if (!(err instanceof HTTPException)) throw err;
    const res = err.getResponse();
    const body = await res.text();
    const status = /unsupported protocol version/i.test(body) ? 400 : res.status;
    return new Response(body, { status, headers: res.headers });
  }
}
