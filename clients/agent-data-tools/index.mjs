// Client for Agent Data Tools: pay-per-call data tools for AI agents. No dependencies; Node 20+, Deno, Bun, Workers and browsers.
export const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const MAX_URL = 6000;

/** A tool call that did not return data. `status` is the HTTP status; `body` is the parsed answer. */
export class ToolError extends Error {
  constructor(message, status, body) { super(message); this.name = "ToolError"; this.status = status; this.body = body; }
}
/** HTTP 402: the free calls are used up (or the tool has none) and no way to pay was configured. */
export class PaymentRequired extends ToolError {
  constructor(message, status, body, priceUsd, buyUrl) { super(message, status, body); this.name = "PaymentRequired"; this.priceUsd = priceUsd; this.buyUrl = buyUrl; }
}

const priceOf = (body) => { const a = Number(body?.accepts?.[0]?.amount); return Number.isFinite(a) ? a / 1e6 : null; };

export class AgentDataTools {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] Prepaid card-credit key (adt_…) from /credits; default: the ADT_API_KEY environment variable.
   * @param {typeof fetch} [options.fetch] A fetch that pays HTTP 402 itself, such as @x402/fetch's wrapper around your wallet.
   * @param {string} [options.origin] Service origin.
   * Without a key or a paying fetch, calls use the free trial (25 successful calls per caller; AI media, rendering and search tools excluded).
   */
  constructor({ apiKey, fetch: paying, origin = ORIGIN } = {}) {
    this.apiKey = apiKey ?? globalThis.process?.env?.ADT_API_KEY;
    this.paying = paying;
    this.fetch = paying ?? globalThis.fetch;
    this.origin = origin.replace(/\/$/, "");
    this.catalog = null;
  }

  /** Every tool: `{ name, path, price, summary, description, params }`. `search` keeps those whose text holds every word. */
  async tools({ search } = {}) {
    if (!this.catalog) {
      const res = await globalThis.fetch(`${this.origin}/openapi.json`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new ToolError(`could not read the catalog: HTTP ${res.status}`, res.status, null);
      const api = await res.json();
      this.catalog = Object.entries(api.paths).flatMap(([path, ops]) => {
        const op = ops.get;
        const amount = op?.["x-payment-info"]?.price?.amount;
        if (!op?.operationId || amount === undefined) return [];
        return [{ name: op.operationId, path, price: `$${amount}`, summary: op.summary ?? "", description: op.description ?? "", params: (op.parameters ?? []).filter((p) => p.in === "query").map((p) => ({ name: p.name, required: Boolean(p.required), type: p.schema?.type ?? "string", description: p.description ?? "" })) }];
      });
    }
    if (!search) return this.catalog;
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return this.catalog.filter((t) => { const text = `${t.name} ${t.summary} ${t.description}`.toLowerCase(); return words.every((w) => text.includes(w)); });
  }

  /** Call a tool by path (`/weather`) or name (`pdf_text`) with its inputs; resolves to the tool's JSON answer. */
  async call(tool, inputs = {}) {
    let path = tool;
    if (!tool.startsWith("/")) {
      const hit = (await this.tools()).find((t) => t.name === tool);
      if (!hit) throw new ToolError(`no tool named "${tool}"; see tools()`, 404, null);
      path = hit.path;
    }
    const headers = { accept: "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(inputs)) if (v !== undefined && v !== null) query.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    if (!this.apiKey && !this.paying) query.set("trial", "1");
    const url = `${this.origin}${path}?${query}`;
    // Long inputs (a page to publish, a document to summarise) go as a flat JSON body, which the service reads the same way.
    const res = url.length <= MAX_URL
      ? await this.fetch(url, { headers })
      : await this.fetch(`${this.origin}${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(query)) });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (res.status === 402) {
      const price = priceOf(body);
      throw new PaymentRequired(`${path} needs payment${price === null ? "" : ` ($${price})`}: pass apiKey (card credits from ${this.origin}/credits, from $1) or a paying fetch (x402)`, 402, body, price, `${this.origin}/credits`);
    }
    if (!res.ok) throw new ToolError(`${path} answered HTTP ${res.status}: ${body?.error ?? String(text).slice(0, 200)}`, res.status, body);
    return body;
  }

  /** The named tools as OpenAI function-calling definitions; pass the model's tool call to `call(name, JSON.parse(arguments))`. */
  async openAiTools(names) {
    const all = await this.tools();
    const picked = names ? names.map((n) => { const t = all.find((x) => x.name === n || x.path === n); if (!t) throw new ToolError(`no tool named "${n}"`, 404, null); return t; }) : all;
    return picked.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description.slice(0, 1000),
        parameters: { type: "object", properties: Object.fromEntries(t.params.map((p) => [p.name, { type: p.type, description: p.description }])), required: t.params.filter((p) => p.required).map((p) => p.name) },
      },
    }));
  }
}
