import { pickFields } from "./lib/fields";
import { mcpClientName } from "./lib/caller";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { WEB_PACKS, apiKeyFrom, isCreditKey } from "./lib/credits";
import { keyPrice, keyPriceFor } from "./lib/key-prices";
import { recommend } from "./routes/recommend";
import { creditCharger, directoryInstructions, mcpInstructions, paymentHint, useDailyCall, useFreeCall } from "./lib/credit-routes";
import { CHATGPT_CALLS_PER_DAY, CHATGPT_CALLS_TOTAL_PER_DAY, CHATGPT_TOOLS } from "./lib/chatgpt-tools";
import { ENTRY_OF } from "./routes/entry-paths";
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
import { COMPACT_BUNDLE, COMPACT_CAPPED_BUNDLE, COMPACT_PRICE_CEILING, COMPACT_TOOLS, aboveCompactCeiling, annotationsFor, compactPricePermits, compactReach, directoryToolDescription, mcpName, protocolTool, toolDescription, toolInputShape, toolName } from "./mcp-contract";
import { relatedTools } from "./lib/related";
import { TOOLS } from "./tools";
import { bazaarInputProperties, builderCodeExtension, exampleInput, listingDescription, listingName, listingOutputSchema, listingTags } from "./lib/bazaar-extension";
import { salesOrdered } from "./lib/discovery-index";
import { EXTRA_CHAIN_PATHS } from "./routes/chain-reads";

type Args = Record<string, unknown>;
type Accepts = Parameters<typeof createPaymentWrapper>[1]["accepts"];

export { toolName } from "./mcp-contract";

/**
 * Images and audio go back as MCP image and audio blocks, never as base64 inside the JSON text: a client does not have to
 * parse it out, and a model does not read it as text. A spoken page is about 800 KB of base64 (11 Nov 2026), which as text
 * would fill an assistant's context after the call was paid.
 */
export function toContent(value: unknown) {
  const { imageBase64, audioBase64, ...rest } = value as Record<string, unknown>;
  const media = typeof imageBase64 === "string" ? { type: "image", data: imageBase64, mimeType: String(rest.contentType ?? "image/jpeg") }
    : typeof audioBase64 === "string" ? { type: "audio", data: audioBase64, mimeType: String(rest.contentType ?? "audio/mpeg") } : null;
  if (!media) return [{ type: "text", text: JSON.stringify(value) }];
  return [{ type: "text", text: JSON.stringify(rest) }, media];
}

/** A failed tool returns isError, which makes the payment wrapper cancel the charge. */
async function runTool(env: Env, e: Endpoint & { path: EndpointPath }, args: Args) {
  try {
    const path: EndpointPath = e.path;
    const result = pickFields(await TOOLS[path](env, (name) => (args[name] === undefined ? undefined : String(args[name]))), args.only === undefined ? undefined : String(args.only));
    const { imageBase64: _image, audioBase64: _audio, ...structuredContent } = result as Record<string, unknown>;
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
  // One more try on a fresh server, as the HTTP paywall does: a failed start-up lost the whole MCP call.
  try { return await startPayments(env); } catch (err) { console.error("mcp payment start-up failed; retrying once", err); }
  return startPayments(env);
}

async function startPayments(env: Env) {
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
/**
 * The one-step card offer for a signed-in person whose free calls ran out. People on /mcp/account ran out several times a
 * day (24-26 Oct 2026: airport status 17 times in a day, company lookups, dictionary) and were sent to a /credits page to
 * find a pack themselves; nobody bought. The $1 checkout link is the same one the open /mcp payment hint shows.
 */
function cardStep(origin: string, cardReady: boolean) {
  const [starter] = WEB_PACKS;
  if (!cardReady || !starter) return `To continue, buy credits at ${origin}/credits, then reconnect and sign in with your key.`;
  return `To continue, tell your user: pay $${starter.usdCents / 100} by card at ${starter.url} (Stripe; ${starter.credits.toLocaleString("en-US")} credits, about 100 calls at $0.01 or 500 at $0.002; failed calls are never charged). The key appears right after payment; then reconnect this connector and choose "Sign in with key". Other packs: ${origin}/credits.`;
}
/** Tools that generate images or audio with AI models: not offered on the signed-in directory server. */
const GENERATIVE_MEDIA: ReadonlySet<string> = new Set(["/image", "/image/generate", "/ai/speech", "/ai/tts", "/text-to-speech"]);
/** Left out of the ChatGPT plugin server (/mcp/chatgpt) after OpenAI's scan of 26 Oct 2026 flagged them:
 *  raw eth_call runs operations it does not expose one by one; the card-number and PII tools read as
 *  requests for payment-card data; two names read as exaggerated; memory writes are hard-to-reverse changes. */
const DIRECTORY_EXCLUDED: ReadonlySet<string> = new Set([
  "/base/call", "/eth/call", "/arb/call", "/op/call", "/polygon/call",
  "/validate/luhn", "/text/pii", "/mev-simulator", "/liquidity-pool-audit",
  "/memory/set", "/memory/get", "/memory/list", "/memory/delete",
  // Publishing a page is a write on the public web that cannot be withdrawn (10 Nov 2026): not for the directory servers.
  "/page/publish", "/page/host",
  // Brave Search results: its API terms limit redistribution (accepted risk on our own site), and the plugin
  // submission asks us to confirm full rights to every third-party API the plugin uses.
  "/search", "/search/web", "/web/search", "/news", "/news/search", "/crypto/news", "/pack/web-research", "/ai/answer", "/ai/fact-check", "/pack/news-sentiment",
]);
const inputShapes = new Map<string, ReturnType<typeof toolInputShape>>();
const listedTools = new Map<string, ReturnType<typeof protocolTool>[]>();

/**
 * The compact server, /mcp/compact (also /mcp/k/<key>/compact and /mcp/account/compact): the whole catalog behind three
 * tools. Why (11 Nov 2026): /mcp lists 452 tools, 568,570 bytes of definitions, and /mcp/chain 366; an assistant that
 * connects carries all of it in its context before the first call. The sellers that agents do install serve thousands
 * of tools through a find / inspect / run trio. Here that is find_tool (the free finder, word matching only),
 * tool_details and call_tool. call_tool runs the same per-tool call the ordinary servers register (`trackedFor`), so
 * free calls, a key's credits, x402 payment requests, refunds, the funnel and the next-tool names are unchanged, and a
 * call is counted and priced as the tool it runs. The four tools that write are not reachable here, which is what lets
 * call_tool be annotated read-only like every other tool. A tool priced above COMPACT_PRICE_CEILING runs only when the
 * call names its price in max_price; on the capped twin (/mcp/compact-capped, mcp-contract.ts) such a tool is absent.
 */
export { COMPACT_BUNDLE, COMPACT_CAPPED_BUNDLE, COMPACT_PRICE_CEILING, COMPACT_TOOLS, compactReach };
const compactHow = (capped: boolean) => `This is the compact server: three tools reach the whole catalog. find_tool: say the job in plain words and get the tools that do it (free). tool_details: one tool's inputs, price and an example call (free). call_tool: run a tool by name with its arguments, at that tool's own price (${capped ? `never more than ${COMPACT_PRICE_CEILING} a call` : `a tool above ${COMPACT_PRICE_CEILING} a call runs only when the call names its price in max_price`}). Every tool name in the rest of this text is a name for call_tool.`;const compactText = (value: unknown, isError = false) => ({ ...(isError ? { isError: true as const } : {}), content: [{ type: "text" as const, text: JSON.stringify(value) }] });

function registerCompactTools(
  mcp: McpServer, env: Env, origin: string, endpoints: Endpoint[],
  shapeOf: (e: Endpoint) => Record<string, z.ZodTypeAny>,
  trackedFor: (e: Endpoint) => (args: Args, extra: unknown) => Promise<unknown>,
  // capped: the twin without max_price. priceFor: what this caller pays for one call of a tool (a key may pay less).
  capped: boolean, priceFor: (e: Endpoint) => string,
) {
  const byName = new Map(endpoints.map((e) => [toolName(e), e]));
  // A tool by its MCP name (weather_forecast), its path (/weather/forecast) or the path without the slash.
  const lookup = (name: string) => { const n = name.trim(); return byName.get(mcpName(n.startsWith("/") ? n : `/${n}`)); };
  const unknown = (name: string) => compactText({ error: `no tool named ${JSON.stringify(name.slice(0, 80))} on this server. Nothing was charged.`, next: "call find_tool with the job in plain words to get the right name" }, true);
  const priced = (e: Endpoint) => {
    const withKey = keyPriceFor(e.path, e.price);
    return { tool: toolName(e), title: e.summary, price: e.price, ...(withKey ? { priceWithKey: withKey } : {}), inFreeCalls: !CAPACITY_LIMITED.has(e.path), ...(aboveCompactCeiling(priceFor(e)) ? { needsMaxPrice: priceFor(e) } : {}) };
  };
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

  mcp.tool(
    "find_tool",
    `Find which of this service's ${endpoints.length} tools does a job. Say the job in plain words ("current weather in Paris", "text of a PDF", "is this wallet sanctioned") and get up to ten tools, best match first, each with its name for call_tool, what it does, its price and its required inputs. Free; call it before call_tool whenever you do not already know the tool's name.`,
    {
      need: z.string().min(2).max(300).describe("The job in plain words, for example: current weather in Paris"),
      count: z.number().int().min(1).max(10).optional().describe("How many tools to return, 1-10 (default 5)"),
    },
    { title: "Find a tool for a job", ...annotations, idempotentHint: true, openWorldHint: false },
    async ({ need, count }) => {
      try {
        const found = await recommend(env, need, 15, null, origin);
        const tools = found.picks.map((p) => byName.get(p.mcpTool)).filter((e): e is Endpoint => Boolean(e)).slice(0, count ?? 5)
          .map((e) => ({ ...priced(e), does: e.description.slice(0, 280), requiredInputs: Object.entries(e.params).filter(([, p]) => p.required).map(([name]) => name), exampleArguments: exampleInput(e) }));
        if (!tools.length) return compactText({ error: `no tool here matches ${JSON.stringify(need.slice(0, 80))}. Nothing was charged.`, catalog: `${origin}/tools` }, true);
        return compactText({ need, tools, next: "tool_details for every input of one tool, or call_tool with its name and arguments" });
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        return compactText({ error: err.message.replace("; nothing was charged", "").replace(/ The full catalog is at \S+$/, ""), note: "Nothing was charged.", catalog: `${origin}/tools` }, true);
      }
    },
  );

  mcp.tool(
    "tool_details",
    "Everything needed to call one tool: what it does, every input with its type, whether it is required and an example value, the price per successful call (and the lower price with a prepaid key where there is one), whether it is in the free calls, an example call and the shape of its answer. Free. Take the name from find_tool.",
    { name: z.string().min(1).max(120).describe("The tool's name from find_tool, for example weather_forecast") },
    { title: "Inputs, price and example of one tool", ...annotations, idempotentHint: true, openWorldHint: false },
    async ({ name }) => {
      const e = lookup(name);
      if (!e) return unknown(name);
      const example = JSON.stringify(e.outputExample);
      return compactText({
        ...priced(e),
        does: e.description,
        inputs: Object.entries(e.params).map(([input, p]) => ({ name: input, type: p.type, required: Boolean(p.required), description: p.description, ...(p.enum ? { oneOf: p.enum } : {}), ...(p.example !== "" ? { example: p.example } : {}) })),
        exampleCall: { name: toolName(e), arguments: exampleInput(e) },
        // A long example answer is cut: enough to see the fields, not enough to fill the context.
        exampleAnswer: example.length > 1_500 ? `${example.slice(0, 1_500)}…` : e.outputExample,
        charged: "Only a successful call is charged; a failed call costs nothing.",
      });
    },
  );

  mcp.tool(
    "call_tool",
    `Run one of this service's tools by name. Costs that tool's own price per successful call (most $0.01; ${capped ? `never more than ${COMPACT_PRICE_CEILING}; ` : ""}tool_details and find_tool show it); a failed call costs nothing, and tools marked inFreeCalls run free while the caller has free calls left. Pass the tool's inputs as "arguments". If you do not know the name or the inputs, call find_tool or tool_details first: a wrong name or a missing input is refused before anything is charged.${capped ? "" : ` A tool that costs more than ${COMPACT_PRICE_CEILING} a call (find_tool marks it needsMaxPrice) runs only when you pass that price as "max_price"; without it the call is refused, uncharged, and the refusal states the price.`}`,
    {
      name: z.string().min(1).max(120).describe("The tool's name from find_tool, for example weather_forecast"),
      arguments: z.record(z.string(), z.unknown()).optional().describe("The tool's inputs as an object, for example {\"city\": \"Paris\"}. See tool_details for a tool's inputs"),
      ...(capped ? {} : { max_price: z.union([z.string().max(20), z.number()]).optional().describe(`Only for a tool that costs more than ${COMPACT_PRICE_CEILING} a call: the most this call may cost, for example "$1.00". Leave it out for every other tool`) }),
    },
    // Not idempotent: a repeat is charged again, as on the ordinary servers.
    { title: "Run a tool by name", ...annotations, idempotentHint: false },
    (async ({ name, arguments: given, max_price: named }: { name: string; arguments?: Args; max_price?: string | number }, extra: unknown) => {
      const e = lookup(name);
      if (!e) return unknown(name);
      // The same check the ordinary servers make before a tool's handler runs: the tool's own input shape.
      const parsed = z.object(shapeOf(e)).safeParse(given ?? {});
      if (!parsed.success) {
        const problems = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`);
        return compactText({ error: `${toolName(e)} was not run: ${problems.join("; ")}. Nothing was charged.`, inputs: Object.entries(e.params).map(([input, p]) => `${input} (${p.required ? "required" : "optional"} ${p.type})`), exampleCall: { name: toolName(e), arguments: exampleInput(e) } }, true);
      }
      // A dear call is a decision the caller states, not one a model makes by picking a name (the capped twin has no such tool).
      const price = priceFor(e);
      if (!compactPricePermits(price, named)) {
        return compactText({ error: `${toolName(e)} was not run: it costs ${price} per successful call, more than the ${COMPACT_PRICE_CEILING} this server spends on one call unless the call names a higher price. Nothing was charged.`, price, next: `to run it, repeat the call with max_price: "${price}"`, repeatWith: { name: toolName(e), arguments: given ?? {}, max_price: price } }, true);
      }
      return trackedFor(e)(parsed.data as Args, extra);
    }) as never,
  );
}

/** Stateless MCP endpoint: every paid HTTP endpoint is also a paid tool. A bundle serves one catalog section. */
export async function handleMcp(c: Context<{ Bindings: Env }>, bundle = "", urlKey?: string, account?: { key: string | null; sub: string }, directory = false) {
  if (urlKey !== undefined && !isCreditKey(urlKey)) return c.json({ error: "the key in this URL is not a valid API key; copy the connector URL again from your /credits/claim page" }, 401);
  // Stateless server: no server-to-client event stream. A GET would open an SSE stream that never
  // carries anything and hangs until the client gives up (monitors logged these as errors), so answer
  // 405 as the Streamable HTTP spec allows. DELETE (session end) has nothing to end.
  if (c.req.method === "GET" || c.req.method === "DELETE") {
    return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this stateless MCP server has no event stream; send JSON-RPC requests with POST." }, id: null }, 405, { Allow: "POST" });
  }
  // The compact server (/mcp/compact): the whole catalog behind three tools, so a client carries three definitions
  // instead of hundreds. See registerCompactTools below.
  const capped = bundle === COMPACT_CAPPED_BUNDLE;
  const compact = bundle === COMPACT_BUNDLE || capped;
  const catalog = compact ? ENDPOINTS : bundle ? mcpBundleTools(bundle) : ENDPOINTS;
  if (!catalog) return c.json({ error: `unknown MCP bundle; use one of: ${[COMPACT_BUNDLE, COMPACT_CAPPED_BUNDLE, ...Object.keys(MCP_BUNDLES)].join(", ")}` }, 404);
  // The signed-in server is what app directories list; their policy excludes AI generation of images,
  // video and audio, so those two tools stay on the open /mcp and HTTP only.
  // Sales order, as in /discovery/resources: payee and risk checks first, toys last (tools/list and registration).
  // The extra networks' ~200 chain reads (chain-reads.ts EXTRA_CHAINS) are served over HTTP and in the /mcp/chain bundle only:
  // the main and signed-in servers would otherwise list over 500 tools, more than MCP clients handle well.
  // The compact server lists none of them, so it can reach all of them.
  const sized = bundle === "chain" || compact ? catalog : catalog.filter((e) => !EXTRA_CHAIN_PATHS.has(e.path));
  // Both directory servers (Claude's /mcp/account, ChatGPT's /mcp/chatgpt) leave out the tools OpenAI's scan flagged: the
  // same rules (third-party API rights, payment-card data, hard-to-reverse writes) are in Anthropic's directory review (27 Oct 2026).
  // The ChatGPT plugin server has its own fixed list (lib/chatgpt-tools.ts): the tools OpenAI's rules allow and that cost
  // us nothing per call, because inside ChatGPT the service is free.
  const offered = salesOrdered(directory ? ENDPOINTS.filter((e) => CHATGPT_TOOLS.has(e.path))
    // Entry paths are second names for outside search engines; a signed-in user's assistant gets each tool once (1.111.5).
    : account ? sized.filter((e) => !GENERATIVE_MEDIA.has(e.path) && !DIRECTORY_EXCLUDED.has(e.path) && !Object.hasOwn(ENTRY_OF, e.path)) : sized);
  // call_tool is annotated read-only, so the compact server leaves out the four tools that write (memory, page publishing);
  // its capped twin also leaves out any tool above the price ceiling.
  const endpoints = compact ? offered.filter((e) => compactReach(e, capped)) : offered;
  // directory: the ChatGPT plugin server (/mcp/chatgpt). Free inside ChatGPT (its rules allow no sale of digital services
  // and no freemium upsell): a daily allowance per signed-in user, and no price, plan, credit, key, link or request id in
  // anything ChatGPT shows.
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
  // The ChatGPT server never spends credits: a key that came with the sign-in is ignored there.
  const creditKey = paid && !directory ? (account ? account.key ?? undefined : apiKeyFrom((name) => c.req.header(name)) ?? urlKey) : undefined;
  // Free calls follow a signed-in person; anonymous callers are told apart by network address.
  const caller = account ? `sub:${account.sub}` : c.req.header("cf-connecting-ip");
  // x402 terms are prepared only when a tool is actually called, so initialize and tools/list stay fast.
  // Signed-in connectors (app directories) never see crypto payment requests: free calls, then a credit key.
  const x402 = paid && !creditKey && !account;
  const freeOnly = paid && !creditKey && Boolean(account);
  let paymentReady: ReturnType<typeof paymentState> | undefined;
  const payment = () => (paymentReady ??= paymentState(env));
  const origin = new URL(c.req.url).origin;
  const mcp = new McpServer({ name: SERVICE_ID, title: SERVICE_NAME, version: MCP_SERVER_VERSION, websiteUrl: origin, icons: [{ src: `${origin}/logo.png`, mimeType: "image/png", sizes: ["512x512"] }, { src: `${origin}/favicon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }] }, { instructions: directory ? directoryInstructions(endpoints.length, CHATGPT_CALLS_PER_DAY) : `${compact ? `${compactHow(capped)} ` : ""}${mcpInstructions(origin, Boolean(creditKey), endpoints.length, mppEnabled(env), Boolean(account))}` });

  // Tools this server offers, so a result names only next tools the client can actually call here.
  const served = new Set(endpoints.map((x) => x.path));
  // One tool's call, with everything a call carries: free calls, a key's credits or an x402 payment, the funnel and the
  // next-tool names. The ordinary servers register it under the tool's own name; the compact server reaches it through call_tool.
  const trackedFor = (e: Endpoint) => {
    const handler = (args: Args) => runTool(env, e, args);
    const callback = creditKey
      ? (args: Args) => creditCharger(env, creditKey, keyPrice(e.path, e.price), origin, directory)(() => handler(args))
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
          // True for both limits (this account's, and the total for all ChatGPT users together).
          ? `Today's call limit is reached (${CHATGPT_CALLS_PER_DAY} calls a day per account). It resets at 00:00 UTC. Nothing was run.`
          : `${CAPACITY_LIMITED.has(e.path) ? "This tool is not included in the free calls." : "The free calls for this account are used up."} ${cardStep(origin, Boolean(env.STRIPE_READ_KEY))}` }] })
      : handler;
    const tracked = async (args: Args, extra: unknown) => withToolTrace(e.path, async () => {
      const meta = (extra as { _meta?: Record<string, unknown> })?._meta;
      const paidAttempt = Boolean(meta?.["x402/payment"]);
      if (paidAttempt) markStage("attempt");
      try {
        // An unpaid call from a caller with free calls left runs free (lib/free-calls.ts); a failure gives it back.
        let freePaused = false;
        const free = directory ? await useDailyCall(env, caller ?? "unknown", CHATGPT_CALLS_PER_DAY, CHATGPT_CALLS_TOTAL_PER_DAY, () => { freePaused = true; })
          : (x402 || freeOnly) && !paidAttempt && !CAPACITY_LIMITED.has(e.path) ? await useFreeCall(env, caller, () => { freePaused = true; }) : null;
        // Free calls that cannot be counted today are not "used up": a signed-in caller without credits is told when they return.
        if (freePaused && freeOnly && !x402) return { isError: true, content: [{ type: "text" as const, text: directory ? "Calls cannot be counted right now, so none can run. Please try again later. Nothing was run." : `${freeCallsPausedNote()} Nothing was charged and no free call was used.` }] };
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
          : free && !result.isError && !directory ? [{ type: "text", text: freeCallNote(free.left, origin) }] : [];
        const requestMeta = directory ? {} : { requestId: trace?.requestId };
        if ("outputSchema" in e && response.isError && response.structuredContent) {
          const {structuredContent, ...errorResult} = response;
          return {...errorResult, content:[{type:"text",text:JSON.stringify(structuredContent)}, ...hint], _meta:{...response._meta,...requestMeta}};
        }
        // The HTTP answer carries three related tools as Link headers; an MCP answer had no next step at all (10 Nov 2026).
        // Names only, in _meta, so the result itself and its output contract are unchanged.
        const next = result.isError ? [] : relatedTools(e.path).filter((r) => served.has(r.path)).map((r) => toolName(r));
        return { ...result, ...(hint.length ? { content: [...(response.content ?? []), ...hint] } : {}), _meta: { ...result._meta, ...requestMeta, ...(next.length ? { relatedTools: next } : {}) } };
      } catch (error) {
        throw error;
      }
    });
    return tracked;
  };
  const shapeOf = (e: Endpoint) => inputShapes.get(e.path) ?? (inputShapes.set(e.path, toolInputShape(e, z)), inputShapes.get(e.path)!);

  if (compact) {
    registerCompactTools(mcp, env, origin, endpoints, shapeOf, trackedFor, capped, (e) => creditKey ? keyPrice(e.path, e.price) : e.price);
  } else {
    for (const e of endpoints) {
      mcp.tool(toolName(e), directory ? directoryToolDescription(e) : toolDescription(e), shapeOf(e), annotationsFor(e.path), trackedFor(e) as never);
    }
    // SDK Zod conversion cannot represent the existing oneOf/not output contract.
    // Advertise it verbatim; TOOLS validates before settlement, rather than after the SDK handler.
    mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: listedTools.get(listKey) ?? (listedTools.set(listKey, endpoints.map((e) => protocolTool(e, directory))), listedTools.get(listKey)!)}));
  }
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
