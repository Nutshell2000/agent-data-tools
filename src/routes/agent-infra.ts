// Checks for agent infrastructure (1.64.0). Bazaar search on 24 Oct 2026, summed 30-day payers over the top 20, nothing of
// ours: openapi 47, api health 38, mcp server check 35 (and x402 endpoint 37, which /x402/check now answers by name).
// Every target goes through parseTarget (no private, loopback or credentialed hosts) and redirects are not followed.
import { entry, need, type Entry, type Input } from "../family";
import { HttpError } from "../lib/env";
import { capBytes, parseTarget } from "../lib/fetch";
import { call, runSections } from "./packs";
import { X402_CHECK } from "./x402-check";

const UA = "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)";
async function getCapped(url: URL, init: RequestInit, limit: number) {
  let res: Response;
  try { res = await fetch(url.href, { ...init, redirect: "manual", signal: AbortSignal.timeout(9_000), headers: { "user-agent": UA, ...(init.headers as Record<string, string> | undefined) } }); }
  catch (e) { throw new HttpError(e instanceof Error && e.name === "TimeoutError" ? 504 : 502, "the server could not be reached or did not answer within 9 seconds"); }
  let truncated = false;
  const bytes = res.body ? new Uint8Array(await new Response(capBytes(res.body, limit, () => { truncated = true; })).arrayBuffer()) : new Uint8Array();
  return { res, text: new TextDecoder().decode(bytes), truncated };
}

// ---------- OpenAPI ----------
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
type Spec = { openapi?: string; swagger?: string; info?: Record<string, unknown>; servers?: { url?: string }[]; host?: string; basePath?: string; schemes?: string[]; paths?: Record<string, Record<string, Record<string, unknown>>>; components?: { securitySchemes?: Record<string, Record<string, unknown>> }; securityDefinitions?: Record<string, Record<string, unknown>> };
export function summariseSpec(spec: Spec, maxOps = 150) {
  if (!spec || typeof spec !== "object" || (!spec.openapi && !spec.swagger) || !spec.paths) throw new HttpError(422, "this is not an OpenAPI or Swagger document (no openapi/swagger version or paths)");
  const ops: { method: string; path: string; summary: string | null; operationId: string | null; deprecated: boolean; paid: boolean }[] = [];
  const byMethod: Record<string, number> = {};
  const tags = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const m of METHODS) {
      const op = item?.[m];
      if (!op || typeof op !== "object") continue;
      byMethod[m.toUpperCase()] = (byMethod[m.toUpperCase()] ?? 0) + 1;
      for (const t of (op.tags as string[] | undefined) ?? []) tags.add(String(t));
      ops.push({ method: m.toUpperCase(), path, summary: typeof op.summary === "string" ? op.summary.slice(0, 160) : null, operationId: typeof op.operationId === "string" ? op.operationId : null,
        deprecated: op.deprecated === true, paid: "x-payment-info" in op || Object.keys((op.responses as Record<string, unknown>) ?? {}).includes("402") });
    }
  }
  const schemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  const info = spec.info ?? {};
  return {
    format: spec.openapi ? `OpenAPI ${spec.openapi}` : `Swagger ${spec.swagger}`,
    title: typeof info.title === "string" ? info.title : null, version: typeof info.version === "string" ? info.version : null,
    description: typeof info.description === "string" ? info.description.slice(0, 500) : null,
    servers: spec.servers?.map((s) => s.url).filter(Boolean).slice(0, 10) ?? (spec.host ? [`${spec.schemes?.[0] ?? "https"}://${spec.host}${spec.basePath ?? ""}`] : []),
    auth: Object.entries(schemes).map(([name, s]) => ({ name, type: s.type ?? null, scheme: s.scheme ?? null, in: s.in ?? null })),
    operationCount: ops.length, byMethod, tags: [...tags].slice(0, 50), paidOperations: ops.filter((o) => o.paid).length,
    deprecatedOperations: ops.filter((o) => o.deprecated).length, operations: ops.slice(0, maxOps), truncated: ops.length > maxOps,
  };
}

// ---------- MCP ----------
/** A JSON-RPC answer from a streamable-HTTP MCP server: plain JSON, or the first `data:` line of an SSE stream. */
export function rpcResult(text: string): Record<string, unknown> | null {
  const t = text.trim();
  const candidates = t.startsWith("{") ? [t] : t.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  for (const c of candidates) { try { const j = JSON.parse(c); if (j && typeof j === "object" && ("result" in j || "error" in j)) return j; } catch { /* next line */ } }
  return null;
}
async function mcpCall(url: URL, method: string, id: number, session: string | null, params: unknown = {}) {
  const r = await getCapped(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}), "mcp-protocol-version": "2025-06-18" } }, 2_000_000);
  return { status: r.res.status, session: r.res.headers.get("mcp-session-id") ?? session, auth: r.res.headers.get("www-authenticate"), body: rpcResult(r.text), contentType: r.res.headers.get("content-type") };
}

/**
 * Where an API keeps its OpenAPI document: next to each prefix of the endpoint's path (/api/v3/openapi.json for
 * /api/v3/pet), then the common root locations. The pack's own example (petstore3) keeps it at /api/v3/openapi.json,
 * so looking only at /openapi.json reported a failure for it.
 */
export function specCandidates(endpoint: string) {
  const u = new URL(endpoint);
  const parts = u.pathname.split("/").filter(Boolean);
  const prefixes = parts.slice(0, -1).map((_, i) => `/${parts.slice(0, parts.length - 1 - i).join("/")}`).slice(0, 3);
  const paths = [...prefixes.flatMap((p) => [`${p}/openapi.json`, `${p}/swagger.json`]), "/openapi.json", "/swagger.json", "/v3/api-docs", "/openapi.yaml", "/.well-known/openapi.json"];
  return [...new Set(paths)].slice(0, 9).map((p) => `${u.origin}${p}`);
}
/** Tries the candidates in parallel and keeps the first one, in candidate order, that reads as an OpenAPI document. */
async function findSpec(env: Parameters<Entry["run"]>[0], endpoint: string) {
  const tried = specCandidates(endpoint);
  const results = await Promise.allSettled(tried.map((url) => local(env, "/openapi/summary", { url })));
  const at = results.findIndex((r) => r.status === "fulfilled");
  if (at < 0) return { found: false, tried: tried.map((t) => new URL(t).pathname) };
  return { found: true, specUrl: tried[at], ...((results[at] as PromiseFulfilledResult<Record<string, unknown>>).value) };
}

/** Tools this module or /x402/check provide, run in-process (packs.ts cannot import this module: it would be circular). */
function local(env: Parameters<Entry["run"]>[0], path: string, inputs: Record<string, string>) {
  const e = [...AGENT_INFRA, ...X402_CHECK].find((x) => x.endpoint.path === path);
  if (!e) throw new Error(`unknown tool ${path}`);
  const q: Input = (n) => inputs[n];
  return Promise.resolve().then(() => e.run(env, q));
}

export const AGENT_INFRA: Entry[] = [
  entry("/openapi/summary", "OpenAPI spec summary: operations, auth and servers",
    "Read an OpenAPI 3 or Swagger 2 document (JSON or YAML, up to 2 MB) from a URL and summarise it for an agent: title, version, description, servers, auth schemes, operation count by method, tags, which operations are paid (402 or x-payment-info) or deprecated, and up to 150 operations with method, path, summary and operationId. Use before calling an unfamiliar API, to pick an endpoint, or to compare APIs.",
    ["openapi", "swagger", "api-documentation", "api", "developer-tools", "utility"], { url: { type: "string", description: "URL of the OpenAPI or Swagger document", required: true, example: "https://petstore3.swagger.io/api/v3/openapi.json" } },
    { url: "https://petstore3.swagger.io/api/v3/openapi.json", format: "OpenAPI 3.0.4", title: "Swagger Petstore - OpenAPI 3.0", version: "1.0.27", description: "This is a sample Pet Store Server…", servers: ["/api/v3"], auth: [{ name: "petstore_auth", type: "oauth2", scheme: null, in: null }], operationCount: 19, byMethod: { GET: 8, POST: 5 }, tags: ["pet", "store", "user"], paidOperations: 0, deprecatedOperations: 0, operations: [{ method: "PUT", path: "/pet", summary: "Update an existing pet.", operationId: "updatePet", deprecated: false, paid: false }], truncated: false },
    async (_e, q) => {
      const url = parseTarget(need(q, "url", 2_000));
      const { res, text, truncated } = await getCapped(url, { headers: { accept: "application/json, application/yaml, text/yaml, */*" } }, 2_000_000);
      if (res.status >= 300 && res.status < 400) throw new HttpError(422, `the URL redirects to ${res.headers.get("location") ?? "another address"}; pass that URL instead`);
      if (!res.ok) throw new HttpError(422, `the URL answered HTTP ${res.status}`);
      if (truncated) throw new HttpError(422, "the document is larger than 2 MB");
      let spec: Spec;
      try { spec = JSON.parse(text); }
      catch {
        try { const { parse } = await import("yaml"); spec = parse(text, { maxAliasCount: 100 }) as Spec; }
        catch { throw new HttpError(422, "the document is neither valid JSON nor valid YAML"); }
      }
      return { url: url.href, ...summariseSpec(spec) };
    }),

  entry("/mcp/inspect", "MCP server check, inspector: tools, auth and protocol",
    "MCP server check over streamable HTTP: whether it answers initialize, its name, version, protocol version and capabilities, whether it needs sign-in (OAuth or another 401 challenge), and its tools with names, titles, descriptions and input parameters, plus prompt and resource counts. Read-only: it lists, never calls a tool. Use to vet an MCP server before adding it to an agent, or to check your own after a deploy.",
    ["mcp-server-check", "mcp", "mcp-inspector", "agents", "developer-tools", "utility"], { url: { type: "string", description: "The MCP server's streamable-HTTP URL", required: true, example: "https://mcp.deepwiki.com/mcp" } },
    { url: "https://mcp.deepwiki.com/mcp", reachable: true, status: 200, authRequired: false, server: { name: "DeepWiki", version: "2.14.3" }, protocolVersion: "2025-06-18", capabilities: ["prompts", "resources", "tools"], transport: "sse", toolCount: 3, tools: [{ name: "read_wiki_structure", title: null, description: "Get a list of documentation topics for a GitHub repository", params: ["repoName"], required: ["repoName"] }], promptCount: 0, resourceCount: 0 },
    async (_e, q) => {
      const url = parseTarget(need(q, "url", 2_000));
      const init = await mcpCall(url, "initialize", 1, null, { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-data-tools-inspector", version: "1.0" } });
      const base = { url: url.href, status: init.status };
      if (init.status === 401 || init.status === 403) return { ...base, reachable: true, authRequired: true, authChallenge: init.auth?.slice(0, 300) ?? null, server: null, protocolVersion: null, capabilities: [], transport: null, toolCount: null, tools: [], promptCount: null, resourceCount: null };
      const result = init.body?.result as { serverInfo?: { name?: string; version?: string }; protocolVersion?: string; capabilities?: Record<string, unknown> } | undefined;
      if (!result) return { ...base, reachable: init.status < 500, authRequired: false, server: null, protocolVersion: null, capabilities: [], transport: null, toolCount: null, tools: [], promptCount: null, resourceCount: null, note: init.body?.error ? `initialize error: ${JSON.stringify(init.body.error).slice(0, 200)}` : "no JSON-RPC answer to initialize: not a streamable-HTTP MCP endpoint" };
      await mcpCall(url, "notifications/initialized", 0, init.session).catch(() => null);
      const caps = Object.keys(result.capabilities ?? {});
      const [tools, prompts, resources] = await Promise.all([
        caps.includes("tools") ? mcpCall(url, "tools/list", 2, init.session).catch(() => null) : null,
        caps.includes("prompts") ? mcpCall(url, "prompts/list", 3, init.session).catch(() => null) : null,
        caps.includes("resources") ? mcpCall(url, "resources/list", 4, init.session).catch(() => null) : null,
      ]);
      const list = ((tools?.body?.result as { tools?: Record<string, unknown>[] } | undefined)?.tools ?? []);
      return {
        ...base, reachable: true, authRequired: false, server: { name: result.serverInfo?.name ?? null, version: result.serverInfo?.version ?? null },
        protocolVersion: result.protocolVersion ?? null, capabilities: caps, transport: /event-stream/.test(init.contentType ?? "") ? "sse" : "json",
        toolCount: tools ? list.length : null,
        tools: list.slice(0, 100).map((t) => {
          const schema = (t.inputSchema ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
          return { name: String(t.name ?? ""), title: (t.title as string | undefined) ?? null, description: typeof t.description === "string" ? t.description.slice(0, 200) : null, params: Object.keys(schema.properties ?? {}), required: schema.required ?? [] };
        }),
        promptCount: prompts ? ((prompts.body?.result as { prompts?: unknown[] } | undefined)?.prompts ?? []).length : null,
        resourceCount: resources ? ((resources.body?.result as { resources?: unknown[] } | undefined)?.resources ?? []).length : null,
      };
    }),

  entry("/pack/api-health", "API health check: uptime, latency, headers, x402",
    "One call to health-check an API endpoint: up or down with status and response time over three requests (min, median, max), the redirect chain, HTTP security headers, whether it is a paid x402 endpoint and what its payment terms are, and the API's OpenAPI document when one is found at the usual places. Cheaper than the tools bought one by one. Use for API monitoring, before integrating a third-party API, or to check your own after a deploy.",
    ["api-health", "api-check", "x402-endpoint", "pack", "monitoring", "developer-tools"], { url: { type: "string", description: "The API endpoint URL", required: true, example: "https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available" } },
    { pack: "api-health", url: "https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available", up: true, status: 200, latencyMs: { min: 180, median: 210, max: 260 }, redirects: 0, security: { grade: "C" }, x402: { paid: false }, openapi: { found: true, specUrl: "https://petstore3.swagger.io/api/v3/openapi.json", title: "Swagger Petstore - OpenAPI 3.0", operationCount: 19 }, failed: {} },
    async (env, q) => {
      const url = parseTarget(need(q, "url", 2_000)).href;
      const probe = () => call(env, "/url/uptime", { url }) as Promise<{ up: boolean; status: number | null; responseMs: number }>;
      const origin = new URL(url).origin;
      const { data, failed } = await runSections({
        samples: (async () => { const out = []; for (let i = 0; i < 3; i++) out.push(await probe()); return out; })(),
        redirects: call(env, "/url/redirects", { url }),
        security: call(env, "/http/security-headers", { url }),
        x402: local(env, "/x402/check", { url }),
        openapi: findSpec(env, url),
      });
      const s = (data.samples as { up: boolean; status: number | null; responseMs: number }[] | undefined) ?? [];
      const ms = s.map((x) => x.responseMs).sort((a, b) => a - b);
      const x = data.x402 as Record<string, unknown> | undefined;
      const o = data.openapi as Record<string, unknown> | undefined;
      return {
        pack: "api-health", url, up: s.length ? s.every((x) => x.up) : null, status: s.at(-1)?.status ?? null,
        latencyMs: ms.length ? { min: ms[0], median: ms[Math.floor(ms.length / 2)], max: ms.at(-1) } : null,
        redirects: (data.redirects as { redirects?: number } | undefined)?.redirects ?? null,
        security: data.security ? { grade: (data.security as { grade?: string }).grade ?? null, score: (data.security as { score?: number }).score ?? null } : null,
        x402: x ? (x.paywalled === true ? { paid: true, version: x.x402Version ?? null, accepts: x.accepts ?? [], score: x.score ?? null } : { paid: false }) : null,
        openapi: o ? (o.found ? { found: true, specUrl: o.specUrl, title: o.title, version: o.version, operationCount: o.operationCount, paidOperations: o.paidOperations } : { found: false, tried: o.tried }) : null,
        failed,
      };
    }, "$0.01"),
];
