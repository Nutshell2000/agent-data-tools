// The token behind per-connection free MCP calls (16 Nov 2026; the counting and its limits are in lib/free-calls.ts).
// A token is "<32 hex id>.<HMAC-SHA256 of the id, hex>". The signing key is made once by the Metrics object "credits"
// and kept in its storage, so nothing has to be configured; an isolate reads it once. Issuing writes nothing, and a
// token is checked here without a call to the object. It names a connection, never a person: nothing about the caller
// is in it, and it is stored only as the name of a counter once the connection has used a free call.
import { mcpClientName } from "./caller";
import { trialsEnabled, type Env } from "./env";

// A plain string per isolate (never a pending promise: those must stay request-local).
let secret: string | undefined;

async function signingKey(env: Env): Promise<CryptoKey | undefined> {
  if (!secret) {
    const store = env.METRICS?.get(env.METRICS.idFromName("credits"));
    if (!store) return undefined;
    try { secret = await store.freeSessionSecret(); }
    catch (err) { console.error(`free sessions: unavailable (${err instanceof Error ? err.message : err})`); return undefined; }
  }
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const signed = (id: string) => new TextEncoder().encode(`free-session:${id}`);
const TOKEN = /^([0-9a-f]{32})\.([0-9a-f]{64})$/;

/** A new token for a connection that is being opened. */
async function issue(key: CryptoKey): Promise<string> {
  const id = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `${id}.${hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, signed(id))))}`;
}

/** The id inside a token this service signed; undefined for anything else. */
async function verified(key: CryptoKey, token: string | undefined): Promise<string | undefined> {
  const parts = TOKEN.exec(token ?? "");
  if (!parts) return undefined;
  const signature = new Uint8Array(parts[2].match(/../g)!.map((b) => parseInt(b, 16)));
  return (await crypto.subtle.verify("HMAC", key, signature, signed(parts[1]))) ? parts[1] : undefined;
}

/**
 * For one unpaid, keyless MCP request: `id` when it carries a token of ours (its free calls are counted on it), and
 * `send`, the Mcp-Session-Id to answer an initialize request with (the caller's own valid token again, or a new one).
 * Empty when free calls are off or the counter cannot be reached: the address is used then, as before.
 */
export async function freeSessionFor(env: Env, presented: string | undefined, body: () => Promise<string>): Promise<{ id?: string; send?: string }> {
  if (!trialsEnabled(env)) return {};
  const opening = mcpClientName(await body()) !== undefined;
  if (!presented && !opening) return {};
  const key = await signingKey(env);
  if (!key) return {};
  const id = await verified(key, presented);
  return { ...(id ? { id } : {}), ...(opening ? { send: id ? presented : await issue(key) } : {}) };
}
