/**
 * Minimal A2A v1.0 endpoint (19 Nov 2026). We are a tool provider, not a conversational agent: an A2A
 * SendMessage asking for a job in plain words gets back the paid calls that do it, with their prices and
 * how to pay. It never executes a paid call itself and never spends money. This exists so A2A 1.0 clients,
 * which read `supportedInterfaces[0]` to choose a transport, can use our card at all.
 */
import { HttpError, type Env } from "../lib/env";
import { recommend } from "./recommend";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const result = (id: Rpc["id"], value: unknown) => json({ jsonrpc: "2.0", id: id ?? null, result: value });
const error = (id: Rpc["id"], code: number, message: string) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** The job text from an A2A 1.0 unified Part (`text`) or a v0.3 TextPart (`kind:"text"`). */
function jobText(message: unknown): string {
  const parts = (message as { parts?: unknown[] } | undefined)?.parts;
  if (!Array.isArray(parts)) return "";
  for (const part of parts) {
    const p = part as { text?: unknown; kind?: string };
    if (typeof p?.text === "string") return p.text.trim().slice(0, 300);
  }
  return "";
}

export async function handleA2a(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "A2A uses POST JSON-RPC at /a2a" }, 405);
  let rpc: Rpc;
  try { rpc = await request.json() as Rpc; } catch { return error(null, -32700, "Parse error"); }
  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return error(rpc?.id ?? null, -32600, "Invalid Request");
  if (rpc.method !== "SendMessage" && rpc.method !== "message/send") return error(rpc.id ?? null, -32601, "Method not found");
  const need = jobText(rpc.params?.message);
  if (!need) return error(rpc.id ?? null, -32602, "Invalid params: the message needs a text part with the job in plain words");

  let found;
  try { found = await recommend(env, need, 3, null, origin); }
  catch (e) {
    const reason = e instanceof HttpError ? e.message.replace(/; nothing was charged$/, "") : "the lookup could not be completed";
    return result(rpc.id ?? null, {
      role: "ROLE_AGENT",
      parts: [{ text: `${reason}. Full catalog: ${origin}/discovery/resources`, mediaType: "text/plain" }],
    });
  }
  const lines = found.picks.map((p, i) => `${i + 1}. ${p.name} (${p.price}) — ${p.what}\n   GET ${p.call.url}`);
  const text = `Found ${found.picks.length} paid data tools for "${found.need}":\n${lines.join("\n")}\n\n${found.howToPay}\nCatalog: ${origin}/discovery/resources`;
  const contextId = crypto.randomUUID();
  return result(rpc.id ?? null, {
    id: crypto.randomUUID(),
    contextId,
    status: { state: "TASK_STATE_COMPLETED", timestamp: new Date().toISOString() },
    artifacts: [{
      artifactId: crypto.randomUUID(),
      parts: [
        { text, mediaType: "text/plain" },
        { data: { picks: found.picks, howToPay: found.howToPay, catalog: `${origin}/discovery/resources`, mcp: found.mcp }, mediaType: "application/json" },
      ],
    }],
  });
}
