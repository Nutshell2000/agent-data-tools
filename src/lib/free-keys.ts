// Free keys by e-mail (the owner, 14 Nov 2026: "Yes, 100 a month"). A visitor leaves an address, gets one message
// with a link, and the link shows a key that makes FREE_KEY_CALLS successful calls each calendar month on the tools
// outside CAPACITY_LIMITED (lib/credits.ts `issueFreeKey`, `spendCredits`). Why: every API this service is compared
// with gives 50-1,000 calls a month to an e-mailed key, and 23,978 refusals after our 3 keyless calls led to no sale.
//
// Only a hash of the address is kept: enough to give one address one key, not enough to write to anyone again.
// Off unless FREE_KEYS is "on" and both EMAIL (a send_email binding) and FREE_KEY_FROM are set, so nothing is
// offered that cannot be delivered.
import { Hono, type Context } from "hono";
import type { Env } from "./env";
import { FREE_KEY_CALLS, hashCreditKey, newCreditKey, utcMonth } from "./credits";
import { callerHash, utcDay } from "./free-calls";
import { prefersHtml } from "./negotiate";
import { markStage } from "./funnel";

type C = Context<{ Bindings: Env }>;

/** Sign-ups one network address may start in a UTC day, and all of them together: a cap on mail sent, not on keys used. */
export const FREE_KEY_REQUESTS_PER_CALLER = 3;
export const FREE_KEY_REQUESTS_PER_DAY = 300;
/** How long the link in the message works. */
export const FREE_KEY_LINK_HOURS = 24;

export const freeKeysOn = (env: Pick<Env, "FREE_KEYS" | "FREE_KEY_FROM" | "EMAIL" | "TRIALS" | "METRICS">): boolean =>
  env.FREE_KEYS === "on" && Boolean(env.EMAIL && env.FREE_KEY_FROM && env.TRIALS && env.METRICS);

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const sha256Hex = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The address as one person has it, or null when it is not an address: lower case, a "+tag" dropped, and the dots
 * Gmail ignores removed, so the usual ways of writing one mailbox twice give the same key.
 */
export function normalEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const address = raw.trim().toLowerCase();
  if (address.length > 254 || !/^[^\s@<>()",;:\\]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(address) || address.includes("..")) return null;
  const at = address.lastIndexOf("@");
  let local = address.slice(0, at).split("+")[0];
  let domain = address.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return local ? `${local}@${domain}` : null;
}
export const emailHash = (normal: string) => sha256Hex(`free-key-email:${normal}`);

const pendingKey = (tokenHash: string) => `freekey:pending:${tokenHash}`;
const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Counts one sign-up for this address and the day; false when either is used up. KV: close enough for a mail cap. */
async function withinLimits(kv: KVNamespace, ip: string | undefined): Promise<boolean> {
  const day = utcDay();
  const callerKey = `freekey:rate:${day}:${await callerHash(ip ?? "unknown")}`;
  const totalKey = `freekey:total:${day}`;
  const [mine, all] = await Promise.all([kv.get(callerKey), kv.get(totalKey)]);
  if (Number(mine ?? 0) >= FREE_KEY_REQUESTS_PER_CALLER || Number(all ?? 0) >= FREE_KEY_REQUESTS_PER_DAY) return false;
  await Promise.all([
    kv.put(callerKey, String(Number(mine ?? 0) + 1), { expirationTtl: 2 * 86_400 }),
    kv.put(totalKey, String(Number(all ?? 0) + 1), { expirationTtl: 2 * 86_400 }),
  ]);
  return true;
}

function page(title: string, body: string, indexable = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${indexable ? "" : `<meta name="robots" content="noindex">`}<meta name="referrer" content="no-referrer"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 16px;color:#1b1b1b;background:#fff}code,pre{background:#f2f2f2;padding:.1rem .3rem;border-radius:4px;overflow-wrap:anywhere}pre{padding:.75rem;white-space:pre-wrap}input[type=email]{font:inherit;padding:.5rem;width:100%;max-width:22rem;box-sizing:border-box}button{font:inherit;padding:.5rem .9rem;border:1px solid #1b1b1b;border-radius:6px;background:none;color:inherit;cursor:pointer}@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}code,pre{background:#262626}button{border-color:#eee}}</style></head><body>${body}</body></html>`;
}

const WHAT = `${FREE_KEY_CALLS} successful calls each calendar month, for as long as you use it. Failed calls do not count. It covers the tools that read and compute (PDF text, page text, company and VAT checks, DNS, prices, chain reads and the rest); web search, news, AI models, speech, images, browser rendering and screenshots need credits.`;
const PRIVACY = "We keep a hash of your address so one address gets one key. The address itself is not stored, and we send this one message only.";

export const freeKeys = new Hono<{ Bindings: Env }>();

freeKeys.get("/keys/free", (c) => {
  const on = freeKeysOn(c.env);
  const origin = new URL(c.req.url).origin;
  if (!prefersHtml(c.req.header("accept"), c.req.header("user-agent"))) {
    return c.json(on
      ? { freeKey: true, callsEachMonth: FREE_KEY_CALLS, what: WHAT, how: `POST ${origin}/keys/free with JSON {"email":"you@example.com"}; open the link in the message to see the key`, privacy: PRIVACY }
      : { freeKey: false, note: `Free keys are not offered right now. Try a tool without a key, or buy credits from $1 at ${origin}/credits.` }, on ? 200 : 404);
  }
  if (!on) return c.html(page("Free API key", `<h1>Free keys are not offered right now</h1><p>You can try most tools without a key, or <a href="/credits">buy credits from $1</a>.</p>`), 404);
  return c.html(page(`Free API key: ${FREE_KEY_CALLS} calls a month`, `<h1>A free API key: ${FREE_KEY_CALLS} calls a month</h1><p>${esc(WHAT)}</p>
<form method="post" action="/keys/free"><p><label>Your e-mail address<br><input type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label></p><p><button type="submit">Send me the link</button></p></form>
<p>${esc(PRIVACY)} <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p><p>Need more? <a href="/credits">Credits from $1, or a monthly plan</a>; they go on the same key.</p>`, true));
});

freeKeys.post("/keys/free", async (c) => {
  c.header("Cache-Control", "no-store");
  const html = prefersHtml(c.req.header("accept"), c.req.header("user-agent"));
  const answer = (status: 200 | 400 | 404 | 429 | 503, title: string, text: string) => html
    ? c.html(page(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`), status)
    : c.json(status === 200 ? { sent: true, note: text } : { error: text }, status);
  if (!freeKeysOn(c.env)) return answer(404, "Free keys are not offered right now", "Try a tool without a key, or buy credits at /credits.");
  const type = c.req.header("content-type") ?? "";
  const sent = type.includes("json")
    ? (await c.req.json().catch(() => null) as { email?: unknown } | null)?.email
    : (await c.req.parseBody().catch(() => ({} as Record<string, unknown>))).email;
  const normal = normalEmail(sent);
  if (!normal) return answer(400, "That is not an e-mail address", "Send one address, such as you@example.com.");
  const kv = c.env.TRIALS!;
  if (!await withinLimits(kv, c.req.header("cf-connecting-ip")).catch(() => false)) return answer(429, "Too many sign-ups from here today", "Try again tomorrow (UTC), or buy credits at /credits.");
  const token = newToken();
  await kv.put(pendingKey(await sha256Hex(token)), JSON.stringify({ emailHash: await emailHash(normal), at: new Date().toISOString() }), { expirationTtl: FREE_KEY_LINK_HOURS * 3600 });
  const origin = new URL(c.req.url).origin;
  const link = `${origin}/keys/free/confirm?token=${token}`;
  try {
    // The message goes to the address as typed; only its hash was stored above.
    await c.env.EMAIL!.send({
      to: String(sent).trim(), from: c.env.FREE_KEY_FROM!, subject: "Your free API key",
      text: `Open this link to see your free API key (${FREE_KEY_CALLS} calls a month):\n\n${link}\n\nThe link works for ${FREE_KEY_LINK_HOURS} hours. If you did not ask for a key, ignore this message; nothing else will be sent.\n`,
    });
  } catch (e) {
    console.error(`free key: mail not sent (${(e as { code?: string })?.code ?? "error"})`);
    return answer(503, "The message could not be sent", "Nothing was created. Try again in a few minutes.");
  }
  return answer(200, "Check your inbox", `We sent a link to that address. Open it within ${FREE_KEY_LINK_HOURS} hours to see your key.`);
});

freeKeys.get("/keys/free/confirm", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const html = prefersHtml(c.req.header("accept"), c.req.header("user-agent"));
  const fail = (status: 400 | 404 | 503, text: string) => html ? c.html(page("Free API key", `<h1>Not ready</h1><p>${esc(text)}</p>`), status) : c.json({ error: text }, status);
  if (!freeKeysOn(c.env)) return fail(404, "Free keys are not offered right now.");
  const token = c.req.query("token") ?? "";
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return fail(400, "This link is not complete. Open the link from the message again.");
  const kv = c.env.TRIALS!;
  const pending = await kv.get(pendingKey(await sha256Hex(token)), "json").catch(() => null) as { emailHash?: string } | null;
  if (!pending?.emailHash) return fail(400, `This link has expired or was never issued. Ask for a new one at /keys/free.`);
  const store = c.env.METRICS!.get(c.env.METRICS!.idFromName("credits"));
  const fresh = newCreditKey();
  const issued = await store.issueFreeKey({ emailHash: pending.emailHash, key: fresh, keyHash: await hashCreditKey(fresh), perMonth: FREE_KEY_CALLS, month: utcMonth() }).catch((e: unknown) => { console.error("free key: ledger unavailable", e); return null; });
  if (!issued) return fail(503, "The key cannot be made right now. Open the link again in a few minutes.");
  if (!issued.repeated) markStage("free_key_issued");
  const origin = new URL(c.req.url).origin;
  if (!issued.key) return fail(400, "This address already has a key, and it was replaced since it was first shown. Use your current key; its allowance is at /credits/balance.");
  const result = { apiKey: issued.key, callsEachMonth: issued.perMonth, what: WHAT, mcpUrl: `${origin}/mcp/k/${issued.key}`, balance: `${origin}/credits/balance`, addCredits: `${origin}/credits` };
  if (!html) return c.json(result);
  return c.html(page("Your free API key", `<h1>Your free API key</h1><pre>${esc(issued.key)}</pre><p><strong>Save it now.</strong> Opening this link again within ${FREE_KEY_LINK_HOURS} hours shows the same key; after that, keep your own copy.</p><p>${esc(WHAT)}</p>
<h2>Use it</h2><pre>curl -H "Authorization: Bearer ${esc(issued.key)}" "${esc(origin)}/pdf/text?url=https://bitcoin.org/bitcoin.pdf&amp;pages=1"</pre><p>Send a file instead of a link:</p><pre>curl -H "Authorization: Bearer ${esc(issued.key)}" -H "Content-Type: application/pdf" --data-binary @invoice.pdf "${esc(origin)}/pdf/text"</pre>
<p>Calls left this month: <code>${esc(origin)}/credits/balance</code> with the same header. More calls or the tools a free key does not cover: <a href="/credits">credits from $1 or a monthly plan</a>, added to this same key.</p>`));
});
