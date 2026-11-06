/**
 * LLM API price comparison (6 Nov 2026). Demand: an LLM price list (modelprices.xyz /llm/prices) was paid by 5 of the 47
 * open shoppers in the 5 Nov sample of Base transfers: agents choosing a model pay to compare. Source: OpenRouter's public
 * model list (openrouter.ai/api/v1/models, keyless, ~450 models with per-token prices and context lengths, 1.5 s, ~800 KB),
 * kept 10 minutes as plain module data. Prices are OpenRouter's, which pass through most providers' list prices.
 */
import { entry, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

interface OrModel { id: string; name?: string; context_length?: number; created?: number; pricing?: { prompt?: string; completion?: string; image?: string; request?: string }; architecture?: { input_modalities?: string[]; output_modalities?: string[] }; top_provider?: { max_completion_tokens?: number | null } }
let snapshot: { at: number; models: OrModel[] } | undefined;

async function models(): Promise<OrModel[]> {
  if (snapshot && Date.now() - snapshot.at < 600_000) return snapshot.models;
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/models", { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0" }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, "the model list did not answer in time; try again");
  }
  if (!res.ok) throw new HttpError(502, `the model list answered HTTP ${res.status}; try again`);
  const body = (await res.json().catch(() => null)) as { data?: OrModel[] } | null;
  if (!body?.data?.length) throw new HttpError(502, "the model list sent an unreadable answer");
  snapshot = { at: Date.now(), models: body.data };
  return body.data;
}

const perMillion = (v: string | undefined) => {
  const n = Number(v);
  return v === undefined || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 1e6 * 10_000) / 10_000;
};

export function priceRows(list: OrModel[]) {
  return list.map((m) => ({
    id: m.id, name: m.name ?? m.id, provider: m.id.split("/")[0],
    contextLength: m.context_length ?? null, maxOutputTokens: m.top_provider?.max_completion_tokens ?? null,
    inputPerMillionUsd: perMillion(m.pricing?.prompt), outputPerMillionUsd: perMillion(m.pricing?.completion),
    free: m.pricing?.prompt === "0" && m.pricing?.completion === "0",
    inputs: m.architecture?.input_modalities ?? [], outputs: m.architecture?.output_modalities ?? [],
  }));
}

export const LLM_PRICES: Entry[] = [
  entry("/llm/prices", "LLM pricing, compare AI model API prices",
    "Compare the API prices of about 450 LLMs from OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, Qwen and others: USD per million input and output tokens, context length, max output, modalities, and the cost of your call when you give token counts. Filter by name, provider, price cap, context or image input; sort by input, output or blended price. Source: OpenRouter's public model list. Use to pick the cheapest model that fits a job.",
    ["llm-pricing", "model-prices", "ai-model-comparison", "token-prices", "llm", "openrouter"], {
      q: { type: "string", description: "Words in the model id or name, e.g. gpt, claude, llama 70b", example: "llama" },
      provider: { type: "string", description: "Only this provider: openai, anthropic, google, meta-llama, mistralai, deepseek, qwen…", example: "meta-llama" },
      maxInputPrice: { type: "number", description: "Only models at or under this USD per million input tokens", example: 1 },
      minContext: { type: "integer", description: "Only models with at least this context length in tokens", example: 32000 },
      vision: { type: "string", description: "true: only models that take image input", example: "false" },
      inputTokens: { type: "integer", description: "Input tokens of your call, to estimate its cost", example: 2000 },
      outputTokens: { type: "integer", description: "Output tokens of your call, to estimate its cost", example: 500 },
      sort: { type: "string", description: "input (default), output, blended (3:1 input:output) or context", example: "blended" },
      limit: { type: "integer", description: "Number of models (1-50, default 20)", example: 5 },
    },
    {
      count: 1, matched: 41, sort: "blended",
      models: [{ id: "meta-llama/llama-3.3-70b-instruct", name: "Meta: Llama 3.3 70B Instruct", provider: "meta-llama", contextLength: 131072, maxOutputTokens: 16384, inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.25, free: false, inputs: ["text"], outputs: ["text"], estimatedCostUsd: 0.000325 }],
      source: "OpenRouter public model list (openrouter.ai/api/v1/models)", asOf: "2026-11-06T06:00:00.000Z",
    },
    async (_env, q) => {
      const words = (opt(q, "q", 100) ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const provider = opt(q, "provider", 60)?.toLowerCase();
      const maxIn = q("maxInputPrice") === undefined || q("maxInputPrice") === "" ? undefined : num(q, "maxInputPrice", { min: 0, max: 10_000 });
      const minContext = num(q, "minContext", { min: 0, max: 100_000_000, fallback: 0, integer: true });
      const vision = /^(true|1|yes)$/i.test(q("vision") ?? "");
      const inTok = num(q, "inputTokens", { min: 0, max: 100_000_000, fallback: 0, integer: true });
      const outTok = num(q, "outputTokens", { min: 0, max: 100_000_000, fallback: 0, integer: true });
      const sort = (opt(q, "sort", 20) ?? "input").toLowerCase();
      if (!["input", "output", "blended", "context"].includes(sort)) throw new HttpError(400, "sort must be input, output, blended or context");
      const limit = num(q, "limit", { min: 1, max: 50, fallback: 20, integer: true });
      let rows = priceRows(await models()).filter((m) => m.inputPerMillionUsd !== null && m.inputPerMillionUsd >= 0);
      if (words.length) rows = rows.filter((m) => words.every((w) => `${m.id} ${m.name}`.toLowerCase().includes(w)));
      if (provider) rows = rows.filter((m) => m.provider === provider || m.provider.startsWith(provider));
      if (maxIn !== undefined) rows = rows.filter((m) => (m.inputPerMillionUsd ?? Infinity) <= maxIn);
      if (minContext) rows = rows.filter((m) => (m.contextLength ?? 0) >= minContext);
      if (vision) rows = rows.filter((m) => m.inputs.includes("image"));
      const blended = (m: (typeof rows)[number]) => ((m.inputPerMillionUsd ?? 0) * 3 + (m.outputPerMillionUsd ?? 0)) / 4;
      const key: Record<string, (m: (typeof rows)[number]) => number> = { input: (m) => m.inputPerMillionUsd ?? Infinity, output: (m) => m.outputPerMillionUsd ?? Infinity, blended, context: (m) => -(m.contextLength ?? 0) };
      rows.sort((a, b) => key[sort](a) - key[sort](b) || a.id.localeCompare(b.id));
      if (!rows.length) throw new HttpError(404, "no model matches these filters; nothing was charged");
      const out = rows.slice(0, limit).map((m) => ({ ...m, ...(inTok || outTok ? { estimatedCostUsd: Math.round(((inTok * (m.inputPerMillionUsd ?? 0) + outTok * (m.outputPerMillionUsd ?? 0)) / 1e6) * 1e8) / 1e8 } : {}) }));
      return { count: out.length, matched: rows.length, sort, models: out, source: "OpenRouter public model list (openrouter.ai/api/v1/models)", asOf: new Date(snapshot?.at ?? Date.now()).toISOString() };
    }),
];
