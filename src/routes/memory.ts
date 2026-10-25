// Agent memory (25 Oct 2026). Bazaar search that day: "agent memory" summed 52 payers over the top 20 and "key value store"
// 10, with nothing of ours. An agent that saves memory comes back to read it, which makes this the first tool whose buyers
// call it repeatedly by design. Values live in Workers KV under a one-way hash of the caller's namespace (a secret the agent
// chooses; anyone who knows it can read and write), expire after at most 30 days and can be deleted at any time.
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";

const NS = /^[A-Za-z0-9_-]{16,128}$/;
// The published examples use this namespace. It is read-only and holds one fixed value, so the example calls (the Bazaar
// listing payment and a buyer's first try) always answer, and nobody can leave content in a namespace others read.
export const DEMO_NS = "demo-agent-memory-7f3c9a21";
const DEMO: Record<string, string> = { "user-preferences": "{\"language\":\"en\",\"units\":\"metric\"}" };
const DEMO_META = { updatedAt: "2026-10-25T00:00:00.000Z", expiresAt: null, size: 34, demo: true, note: "This is the read-only demo namespace from the examples. Choose your own namespace to save values." };
const MAX_VALUE = 8000, MAX_KEY = 200, MAX_DAYS = 30;
type Meta = { updatedAt: string; expiresAt: string; size: number };
type Kv = Pick<KVNamespace, "get" | "put" | "delete" | "list" | "getWithMetadata">;

const store = (env: Env): Kv | null => env.TRIALS ?? null;

async function nsPrefix(raw: string) {
  if (!NS.test(raw)) throw new HttpError(400, "namespace must be 16 to 128 letters, digits, - or _: a secret you choose, like a password (anyone who knows it can read it)");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`agent-memory:${raw}`));
  return `mem:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}:`;
}

function keyOf(raw: string) {
  const k = raw.trim();
  if (!k || k.length > MAX_KEY || /[\u0000-\u001f\u007f]/.test(k)) throw new HttpError(400, `key must be 1 to ${MAX_KEY} characters without control characters`);
  return k;
}

export async function memorySet(kv: Kv | null, ns: string, key: string, value: string, days: number) {
  const prefix = await nsPrefix(ns), k = keyOf(key);
  if (ns === DEMO_NS) return { key: k, saved: false, ...DEMO_META, size: value.length };
  if (!kv) throw new HttpError(503, "memory storage is not available right now; nothing was charged");
  if (value.length > MAX_VALUE) throw new HttpError(400, `value must be at most ${MAX_VALUE} characters`);
  const now = new Date();
  const meta: Meta = { updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(), size: value.length };
  await kv.put(prefix + k, value, { expirationTtl: Math.round(days * 86_400), metadata: meta });
  return { key: k, saved: true, ...meta };
}

export async function memoryGet(kv: Kv | null, ns: string, key: string) {
  const prefix = await nsPrefix(ns), k = keyOf(key);
  if (ns === DEMO_NS) {
    if (!Object.hasOwn(DEMO, k)) throw new HttpError(404, `the demo namespace holds only "user-preferences"; nothing was charged`);
    return { key: k, value: DEMO[k], ...DEMO_META };
  }
  if (!kv) throw new HttpError(503, "memory storage is not available right now; nothing was charged");
  const hit = await kv.getWithMetadata<Meta>(prefix + k, "text");
  if (hit.value === null) throw new HttpError(404, `no value saved under "${k.slice(0, 60)}" in this namespace (it may have expired); nothing was charged`);
  return { key: k, value: hit.value, ...(hit.metadata ?? {}) };
}

export async function memoryList(kv: Kv | null, ns: string, startsWith?: string, cursor?: string) {
  const prefix = await nsPrefix(ns);
  const extra = startsWith ? keyOf(startsWith) : "";
  if (ns === DEMO_NS) { const keys = Object.keys(DEMO).filter((k) => k.startsWith(extra)).map((k) => ({ key: k, ...DEMO_META, size: DEMO[k].length })); return { keys, count: keys.length, cursor: null }; }
  if (!kv) throw new HttpError(503, "memory storage is not available right now; nothing was charged");
  let page: Awaited<ReturnType<Kv["list"]>>;
  try { page = await kv.list<Meta>({ prefix: prefix + extra, limit: 100, ...(cursor ? { cursor } : {}) }); }
  catch (e) { if (cursor) throw new HttpError(400, "cursor is not one this list returned; nothing was charged"); throw e; }
  return {
    keys: page.keys.map((k) => ({ key: k.name.slice(prefix.length), ...(k.metadata ?? {}) })),
    count: page.keys.length,
    cursor: page.list_complete ? null : (page as { cursor?: string }).cursor ?? null,
  };
}

export async function memoryDelete(kv: Kv | null, ns: string, key: string) {
  const prefix = await nsPrefix(ns), k = keyOf(key);
  if (ns === DEMO_NS) return { key: k, deleted: false, demo: true, note: DEMO_META.note };
  if (!kv) throw new HttpError(503, "memory storage is not available right now; nothing was charged");
  const existed = (await kv.get(prefix + k)) !== null;
  await kv.delete(prefix + k);
  return { key: k, deleted: existed };
}

const NS_PARAM = { type: "string", description: "Your namespace: a secret of 16 to 128 letters, digits, - or _ that you choose and reuse. Anyone who knows it can read and write it, so treat it like a password; send it in a POST body to keep it out of URLs.", required: true, example: "demo-agent-memory-7f3c9a21" } as const;
const KEY_PARAM = { type: "string", description: "The key, up to 200 characters", required: true, example: "user-preferences" } as const;
const NOTE = "Values are kept until they expire (at most 30 days) or are deleted; reads anywhere may lag a write made elsewhere by up to a minute.";

export const MEMORY: Entry[] = [
  entry("/memory/set", "Agent memory, save: key value store for agents",
    `Save a value (up to 8,000 characters of text or JSON) under a key in your own namespace, so an agent can remember facts, preferences or task state between runs. Overwrites an existing key; expires after 1 to 30 days (default 30). ${NOTE} Use to persist what an agent learned for a later call to memory_get.`,
    ["agent-memory", "key-value-store", "kv-store", "memory", "storage"], {
      namespace: NS_PARAM, key: KEY_PARAM,
      value: { type: "string", description: "The text or JSON to save, up to 8,000 characters", required: true, example: "{\"language\":\"en\",\"units\":\"metric\"}" },
      days: { type: "string", description: "Days to keep it, 1 to 30 (default 30)", example: "30" },
    },
    { key: "user-preferences", saved: true, updatedAt: "2026-10-25T15:00:00.000Z", expiresAt: "2026-11-24T15:00:00.000Z", size: 34 },
    async (env, q) => memorySet(store(env), need(q, "namespace", 128), need(q, "key", MAX_KEY), need(q, "value", MAX_VALUE), num(q, "days", { min: 1, max: MAX_DAYS, fallback: MAX_DAYS })),
    "$0.002"),

  entry("/memory/get", "Agent memory, recall: read a saved value",
    `Read the value saved under a key in your namespace with /memory/set, with when it was saved and when it expires. A key that was never saved or has expired is a 404 and is not charged. ${NOTE} Use to recall what an agent saved in an earlier run.`,
    ["agent-memory", "memory-recall", "key-value-store", "kv-store", "memory"], { namespace: NS_PARAM, key: KEY_PARAM },
    { key: "user-preferences", value: "{\"language\":\"en\",\"units\":\"metric\"}", updatedAt: "2026-10-25T15:00:00.000Z", expiresAt: "2026-11-24T15:00:00.000Z", size: 34 },
    async (env, q) => memoryGet(store(env), need(q, "namespace", 128), need(q, "key", MAX_KEY)),
    "$0.002"),

  entry("/memory/list", "Agent memory, list keys: what a namespace holds",
    `List up to 100 keys saved in your namespace, optionally only those starting with a prefix, with their size, save time and expiry; pass the returned cursor for the next page. Values are not included (read them with /memory/get). ${NOTE} Use to see what an agent has saved.`,
    ["agent-memory", "key-value-store", "kv-store", "memory", "list-keys"], {
      namespace: NS_PARAM,
      prefix: { type: "string", description: "Only keys that start with this text", example: "user-" },
      cursor: { type: "string", description: "The cursor from the previous page of this list", example: "cursor-from-previous-page" },
    },
    { keys: [{ key: "user-preferences", updatedAt: "2026-10-25T15:00:00.000Z", expiresAt: "2026-11-24T15:00:00.000Z", size: 34 }], count: 1, cursor: null },
    async (env, q) => memoryList(store(env), need(q, "namespace", 128), opt(q, "prefix", MAX_KEY), opt(q, "cursor", 1000)),
    "$0.002"),

  entry("/memory/delete", "Agent memory, delete a key",
    `Delete the value saved under a key in your namespace now, before it expires. Answers deleted: false when there was nothing to delete. ${NOTE} Use to forget a fact or clear task state.`,
    ["agent-memory", "key-value-store", "kv-store", "memory", "delete"], { namespace: NS_PARAM, key: KEY_PARAM },
    { key: "user-preferences", deleted: true },
    async (env, q) => memoryDelete(store(env), need(q, "namespace", 128), need(q, "key", MAX_KEY)),
    "$0.002"),
];
