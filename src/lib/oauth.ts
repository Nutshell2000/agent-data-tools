// OAuth 2.1 sign-in for MCP clients (Claude, ChatGPT and others), per the MCP authorization spec:
// protected-resource metadata (RFC 9728), authorization-server metadata (RFC 8414), dynamic client
// registration (RFC 7591) and authorization code + PKCE S256. The "account" is a card-credit key: the
// person pastes it on our sign-in page, or continues without one and gets the free calls. /mcp stays
// open; /mcp/account (and /mcp/account/<section>) requires a token and is what directories list.
import { Hono, type Context } from "hono";
import type { Env } from "./env";
import { hashCreditKey, isCreditKey } from "./credits";
import { FREE_CALLS_PER_CALLER, callerHash } from "./free-calls";

type C = Context<{ Bindings: Env }>;
const store = (env: Env) => env.METRICS?.get(env.METRICS.idFromName("credits"));
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const origin = (c: C) => new URL(c.req.url).origin;
type Store = NonNullable<ReturnType<typeof store>>;
const oget = async <T>(s: Store, k: string) => (await s.oauthGet(k)) as T | null;
const otake = async <T>(s: Store, k: string) => (await s.oauthTake(k)) as T | null;

const CODE_TTL = 10 * 60_000;
const ACCESS_TTL = 30 * 24 * 3600_000;
const REFRESH_TTL = 365 * 24 * 3600_000;
export const TOKEN_PREFIX = "adtok_";

export interface Client { clientId: string; clientName: string; redirectUris: string[]; createdAt: string }
interface Grant { key: string | null; sub: string; clientId: string }
interface Code extends Grant { redirectUri: string; challenge: string; expiresAt: number }
interface Token extends Grant { expiresAt: number }

function random(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256url(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A redirect URI a client may register: https anywhere, or http only on loopback (desktop clients). */
export function allowedRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch { return false; }
}

export function protectedResourceMetadata(o: string, resource = `${o}/mcp/account`) {
  return { resource, authorization_servers: [o], bearer_methods_supported: ["header"], resource_name: "Agent Data Tools", resource_documentation: `${o}/llms.txt` };
}

export function authorizationServerMetadata(o: string) {
  return {
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["tools"],
    service_documentation: `${o}/credits`,
  };
}

/** Resolves a bearer token from Authorization to its grant, or null when absent, unknown or expired. */
export async function grantFromRequest(env: Env, authorization: string | undefined): Promise<Grant | null> {
  const token = /^Bearer\s+(adtok_[A-Za-z0-9_-]{20,100})$/i.exec(authorization ?? "")?.[1];
  const s = store(env);
  if (!token || !s) return null;
  const t = await oget<Token>(s, `access:${await sha256url(token)}`);
  if (!t || t.expiresAt < Date.now()) return null;
  return { key: t.key, sub: t.sub, clientId: t.clientId };
}

/** 401 that points MCP clients at the sign-in metadata (MCP authorization spec, RFC 9728 section 5.1). */
export function unauthorized(c: C) {
  c.header("WWW-Authenticate", `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource/mcp/account"`);
  return c.json({ error: "unauthorized", error_description: "Sign in to use this endpoint. The open endpoint /mcp needs no sign-in." }, 401);
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:2.5rem auto;padding:0 16px;color:#1b1b1b;background:#fff}input[type=text]{width:100%;box-sizing:border-box;padding:.6rem;font:inherit;border:1px solid #888;border-radius:6px}button{font:inherit;padding:.55rem 1rem;border-radius:6px;border:1px solid #1f7a4d;background:#1f7a4d;color:#fff;cursor:pointer;margin:.6rem .4rem 0 0}button.alt{background:transparent;color:inherit;border-color:#888}.box{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}.err{color:#b00020}a{color:#1f7a4d}@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}.box{border-color:#444}a{color:#6fd3a0}input[type=text]{background:#222;color:#eee}}</style></head><body>${body}<p><small><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></small></p></body></html>`;
}

interface AuthorizeParams { client_id: string; redirect_uri: string; state: string; code_challenge: string; code_challenge_method: string; response_type: string }

async function checkAuthorize(env: Env, p: Partial<AuthorizeParams>): Promise<{ client: Client } | { error: string; redirectable: boolean }> {
  const s = store(env);
  if (!s) return { error: "sign-in is unavailable right now", redirectable: false };
  const client = p.client_id ? await oget<Client>(s, `client:${p.client_id}`) : null;
  if (!client) return { error: "unknown client_id; the app must register first", redirectable: false };
  if (!p.redirect_uri || !client.redirectUris.includes(p.redirect_uri)) return { error: "redirect_uri is not registered for this client", redirectable: false };
  if (p.response_type !== "code") return { error: "unsupported_response_type", redirectable: true };
  if (!p.code_challenge || p.code_challenge_method !== "S256") return { error: "invalid_request: PKCE with S256 is required", redirectable: true };
  return { client };
}

function authorizeForm(o: string, client: Client, p: AuthorizeParams, error?: string) {
  const hidden = (["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type"] as const)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(p[k] ?? "")}">`).join("");
  const host = new URL(p.redirect_uri).host;
  return page("Sign in · Agent Data Tools", `<h1>Sign in to Agent Data Tools</h1>
<p><strong>${esc(client.clientName)}</strong> wants to use Agent Data Tools for you. You will return to <strong>${esc(host)}</strong>.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/oauth/authorize">${hidden}
<div class="box"><label for="key"><strong>Your API key</strong> (from <a href="${o}/credits" target="_blank">card credits</a>, starts with <code>adt_</code>)</label>
<input type="text" id="key" name="key" autocomplete="off" spellcheck="false" placeholder="adt_…">
<button type="submit" name="mode" value="key">Sign in with key</button></div>
<div class="box"><p>No key yet? Continue with ${FREE_CALLS_PER_CALLER} free calls. You can buy credits later at <a href="${o}/credits" target="_blank">${esc(o.replace(/^https?:\/\//, ""))}/credits</a> and sign in again.</p>
<button class="alt" type="submit" name="mode" value="free">Continue with free calls</button></div>
</form>`);
}

function redirectWith(uri: string, params: Record<string, string>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

async function issueTokens(env: Env, grant: Grant) {
  const s = store(env)!;
  const access = TOKEN_PREFIX + random(32);
  const refresh = "adtref_" + random(32);
  const now = Date.now();
  await s.oauthPut(`access:${await sha256url(access)}`, { ...grant, expiresAt: now + ACCESS_TTL } satisfies Token);
  await s.oauthPut(`refresh:${await sha256url(refresh)}`, { ...grant, expiresAt: now + REFRESH_TTL } satisfies Token);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: "tools" };
}

export const oauth = new Hono<{ Bindings: Env }>();

for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp/account"]) {
  oauth.get(path, (c) => c.json(protectedResourceMetadata(origin(c))));
}
oauth.get("/.well-known/oauth-protected-resource/mcp/account/:bundle", (c) =>
  c.json(protectedResourceMetadata(origin(c), `${origin(c)}/mcp/account/${c.req.param("bundle")}`)));
for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
  oauth.get(path, (c) => c.json(authorizationServerMetadata(origin(c))));
}

oauth.post("/oauth/register", async (c) => {
  const s = store(c.env);
  if (!s) return c.json({ error: "temporarily_unavailable" }, 503);
  let body: { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_client_metadata", error_description: "JSON body required" }, 400); }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(allowedRedirect)) {
    return c.json({ error: "invalid_redirect_uri", error_description: "1-10 redirect_uris, https (or http on localhost)" }, 400);
  }
  const clientName = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : "An AI app";
  const client: Client = { clientId: "adtc_" + random(18), clientName, redirectUris: uris, createdAt: new Date().toISOString() };
  await s.oauthPut(`client:${client.clientId}`, client);
  return c.json({
    client_id: client.clientId, client_name: clientName, redirect_uris: uris, token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], client_id_issued_at: Math.floor(Date.now() / 1000),
  }, 201);
});

oauth.get("/oauth/authorize", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Frame-Options", "DENY");
  const p = c.req.query() as unknown as AuthorizeParams;
  const checked = await checkAuthorize(c.env, p);
  if ("error" in checked) {
    if (checked.redirectable) return c.redirect(redirectWith(p.redirect_uri, { error: checked.error, state: p.state }));
    return c.html(page("Sign-in error", `<h1>Sign-in error</h1><p class="err">${esc(checked.error)}</p>`), 400);
  }
  return c.html(authorizeForm(origin(c), checked.client, p));
});

oauth.post("/oauth/authorize", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Frame-Options", "DENY");
  const form = await c.req.parseBody();
  const p = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)])) as unknown as AuthorizeParams & { key?: string; mode?: string };
  const checked = await checkAuthorize(c.env, p);
  if ("error" in checked) return c.html(page("Sign-in error", `<h1>Sign-in error</h1><p class="err">${esc(checked.error)}</p>`), 400);
  const s = store(c.env)!;
  let key: string | null = null;
  if (p.mode !== "free") {
    const typed = (p.key ?? "").trim();
    if (!isCreditKey(typed) || !(await s.creditBalance(await hashCreditKey(typed)))) {
      return c.html(authorizeForm(origin(c), checked.client, p, "That key was not found. Check it on your /credits/claim page, or continue with free calls."), 400);
    }
    key = typed;
  }
  // One stable subject per key, so free-call counting and tokens follow the person, not the network address.
  // Without a key, the subject is the hashed address of the browser that signs in: a random one per
  // sign-in would hand out a fresh set of free calls every time the person reconnects.
  const sub = key ? `key:${await hashCreditKey(key)}` : `anon:${await callerHash(c.req.header("cf-connecting-ip") ?? "unknown")}`;
  const code = "adtcode_" + random(24);
  await s.oauthPut(`code:${await sha256url(code)}`, { key, sub, clientId: p.client_id, redirectUri: p.redirect_uri, challenge: p.code_challenge, expiresAt: Date.now() + CODE_TTL } satisfies Code);
  return c.redirect(redirectWith(p.redirect_uri, { code, state: p.state }), 302);
});

oauth.post("/oauth/token", async (c) => {
  c.header("Cache-Control", "no-store");
  const s = store(c.env);
  if (!s) return c.json({ error: "temporarily_unavailable" }, 503);
  const form = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
  const bad = (error: string, description: string) => c.json({ error, error_description: description }, 400);
  if (form.grant_type === "authorization_code") {
    const code = await otake<Code>(s, `code:${await sha256url(form.code ?? "")}`);
    if (!code || code.expiresAt < Date.now()) return bad("invalid_grant", "unknown or expired code");
    if (code.clientId !== form.client_id || code.redirectUri !== form.redirect_uri) return bad("invalid_grant", "client_id or redirect_uri does not match");
    if (!form.code_verifier || (await sha256url(form.code_verifier)) !== code.challenge) return bad("invalid_grant", "PKCE verification failed");
    return c.json(await issueTokens(c.env, { key: code.key, sub: code.sub, clientId: code.clientId }));
  }
  if (form.grant_type === "refresh_token") {
    const old = await otake<Token>(s, `refresh:${await sha256url(form.refresh_token ?? "")}`);
    if (!old || old.expiresAt < Date.now()) return bad("invalid_grant", "unknown or expired refresh token");
    if (form.client_id && form.client_id !== old.clientId) return bad("invalid_grant", "client_id does not match");
    return c.json(await issueTokens(c.env, { key: old.key, sub: old.sub, clientId: old.clientId }));
  }
  return bad("unsupported_grant_type", "use authorization_code or refresh_token");
});
