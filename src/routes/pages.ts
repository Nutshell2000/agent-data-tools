// Hosted pages for agents (1.84.0, 31 Oct 2026). Zero.xyz's demand intents on that day: "host static website" 42 buyers in 90
// days with 5 sellers, "host webpage" 22 buyers with 7 sellers; agents want to publish what they produced (a report, a
// table, a summary) at a URL a person can open. One paid call stores a sanitised HTML page in Workers KV for up to 7 days
// and serves it at /p/<id>: no scripts, styles, frames, forms or event handlers survive the sanitiser, every page is
// noindex with a strict Content-Security-Policy, and Llama Guard screens the text before anything is stored. Content is
// the publisher's, as the terms say; the support address takes removal requests.
import { Parser } from "htmlparser2";
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { runAi } from "../lib/ai";
import { GUARD_MODEL, guardVerdict } from "./safety";
import { phishingLookup } from "../lib/phishing-list";

// Not imported from endpoints.ts: that module imports this one through families.ts, so its constants are not set yet here.
export const PUBLIC_ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
/** Free test (owner, 31 Oct 2026; review 15 Dec): does Google crawl these pages on a domain with some standing? */
export const INDEXING_TEST_HOST = "tools.funwords.eu";
export const MAX_HTML = 200_000, MAX_DAYS = 7, MAX_TITLE = 120;
const ALLOWED = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "ul", "ol", "li", "b", "strong", "i", "em", "u", "s", "code", "pre", "blockquote", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "a", "img", "span", "div", "small", "sup", "sub", "dl", "dt", "dd", "figure", "figcaption", "mark", "kbd", "section", "article", "header", "footer", "main", "nav", "aside", "time", "abbr", "cite", "q", "details", "summary"]);
const VOID = new Set(["br", "hr", "img"]);
// Whole subtrees that never reach the page.
const DROP = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "svg", "math", "template", "noscript", "link", "meta", "base", "head", "title", "video", "audio", "source", "track", "canvas", "dialog", "frame", "frameset", "applet"]);
const ATTRS: Record<string, Set<string>> = { a: new Set(["href", "title"]), img: new Set(["src", "alt", "width", "height", "title"]), td: new Set(["colspan", "rowspan"]), th: new Set(["colspan", "rowspan", "scope"]), time: new Set(["datetime"]), abbr: new Set(["title"]), ol: new Set(["start"]), details: new Set(["open"]) };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (v: string, img: boolean) => { const t = v.trim(); if (/^#/.test(t) && !img) return t; try { const u = new URL(t); return (u.protocol === "https:" || (!img && (u.protocol === "http:" || u.protocol === "mailto:"))) ? u.href : null; } catch { return null; } };

/** Rebuilds the HTML from a whitelist of tags and attributes; returns the markup and its visible text. */
export function sanitizeHtml(html: string): { html: string; text: string } {
  let out = "", text = "", drop = 0;
  const open: string[] = [];
  const parser = new Parser({
    onopentag(name, attrs) {
      if (drop || DROP.has(name)) { if (DROP.has(name) || drop) drop++; return; }
      if (!ALLOWED.has(name)) return;
      const keep = ATTRS[name];
      let a = "";
      for (const [k, v] of Object.entries(attrs)) {
        if (!keep?.has(k)) continue;
        if (k === "href" || k === "src") { const u = safeUrl(v, k === "src"); if (!u) continue; a += ` ${k}="${esc(u)}"`; continue; }
        if (k === "colspan" || k === "rowspan" || k === "width" || k === "height" || k === "start") { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 10_000) continue; a += ` ${k}="${n}"`; continue; }
        if (k === "open") { a += " open"; continue; }
        a += ` ${k}="${esc(v).slice(0, 300)}"`;
      }
      if (name === "a") a += ' rel="nofollow noopener noreferrer ugc" target="_blank"';
      if (name === "img") a += ' loading="lazy" referrerpolicy="no-referrer"';
      out += `<${name}${a}>`;
      if (!VOID.has(name)) open.push(name);
    },
    ontext(t) { if (drop) return; out += esc(t); text += t; },
    onclosetag(name) {
      if (drop) { drop--; return; }
      if (!ALLOWED.has(name) || VOID.has(name)) return;
      const i = open.lastIndexOf(name);
      if (i < 0) return;
      while (open.length > i) out += `</${open.pop()}>`;
      if (/^(p|div|li|tr|h[1-6]|blockquote|pre|section|article|dd|dt|figcaption|caption)$/.test(name)) text += "\n";
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(html);
  parser.end();
  while (open.length) out += `</${open.pop()}>`;
  return { html: out, text: text.replace(/[ \t]+/g, " ").split("\n").map((l) => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

// ---- screening before a page is stored (21 Nov 2026) ----
// The moderation model was shown the first 8,000 characters only, so a page could carry anything after a harmless
// opening and be stored on the paid origin. Now every character that is stored is screened first.
//  - The text goes to the model in pieces of SCREEN_CHUNK characters (the size the model has always been given here),
//    each starting SCREEN_OVERLAP characters before the last one ended, so a sentence cut by a boundary is still read
//    whole once.
//  - One model call per piece, at most SCREEN_MAX_CALLS a page: a call of this tool is sold for one cent and every model
//    call takes a place in the day's allowance (lib/ai.ts), so twenty-five calls for one page (200,000 characters) is
//    not affordable. A page with more visible text than four pieces hold is refused, uncharged, rather than stored
//    partly unread. Screening a sample of the pieces was the other choice; it was not taken because whatever is left
//    out of the sample is exactly where unwanted text would be put.
//  - Text a reader sees that is not body text (image descriptions, hover titles) is screened with the rest.
//  - Links and images: a page that points at a host on the phishing lists the service already holds is refused.
export const SCREEN_CHUNK = 8_000, SCREEN_OVERLAP = 200, SCREEN_MAX_CALLS = 4;
/** The most text one page may hold and still be screened whole. */
export const MAX_SCREENED_TEXT = SCREEN_CHUNK + (SCREEN_MAX_CALLS - 1) * (SCREEN_CHUNK - SCREEN_OVERLAP);
/** The most different sites a page may link to: each one is a few list reads, and all of them are checked or none. */
export const MAX_LINK_HOSTS = 50;

/** The pieces the moderation model is given: all of the text, in order, overlapping by SCREEN_OVERLAP. */
export function screenChunks(text: string): string[] {
  const out: string[] = [];
  for (let at = 0; ; at += SCREEN_CHUNK - SCREEN_OVERLAP) {
    out.push(text.slice(at, at + SCREEN_CHUNK));
    if (at + SCREEN_CHUNK >= text.length) return out;
  }
}

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** What the sanitised markup shows or points at besides its body text: attribute text, and the hosts of links and images. */
export function pageExtras(cleanHtml: string): { attributeText: string; hosts: string[] } {
  const words: string[] = [], hosts = new Set<string>();
  for (const m of cleanHtml.matchAll(/ (alt|title|href|src)="([^"]*)"/g)) {
    const value = unesc(m[2]);
    if (m[1] === "alt" || m[1] === "title") { if (value.trim()) words.push(value.trim()); continue; }
    try { const u = new URL(value); if (u.protocol === "http:" || u.protocol === "https:") hosts.add(u.hostname.toLowerCase()); } catch { /* an in-page #anchor */ }
  }
  return { attributeText: words.join("\n"), hosts: [...hosts] };
}

/** Looks one host up in the phishing lists; `null` when the lists cannot be read (not loaded, or not a domain name). */
export type LinkCheck = (host: string) => Promise<{ listed: boolean } | null>;

export type Page = { title: string; html: string; createdAt: string; expiresAt: string; bytes: number };
type Kv = Pick<KVNamespace, "get" | "put">;
export type Moderate = (text: string) => Promise<{ flagged: boolean; categories: { code: string; name: string }[] }>;
const ID = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => ID[b % ID.length]).join("");

/** Sanitise, screen and store one page; the moderation runner is a parameter so tests need no Workers AI. */
export async function publishPage(kv: Kv | null, input: { html: string; title?: string; days?: number }, moderate: Moderate, origin = PUBLIC_ORIGIN,
  // The lists live in the same KV namespace as the pages. Lists that are not loaded must not stop publishing, so a
  // failed lookup is "not known" and the page goes on to moderation; a tool that sells the list check itself
  // (/phishing/check) answers 503 in that case, this one does not sell it.
  linkCheck: LinkCheck = (host) => phishingLookup(kv as unknown as Pick<KVNamespace, "get">, host).catch(() => null)) {
  if (!kv) throw new HttpError(503, "page storage is not available right now; nothing was charged");
  if (input.html.length > MAX_HTML) throw new HttpError(400, `html must be at most ${MAX_HTML} characters`);
  const clean = sanitizeHtml(input.html);
  if (!clean.text && !/<img /.test(clean.html)) throw new HttpError(400, "the page has no visible content after removing scripts, styles and unsupported tags");
  const title = (input.title ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_TITLE) || (clean.text.split("\n")[0] ?? "").slice(0, MAX_TITLE) || "Untitled page";
  const extras = pageExtras(clean.html);
  const screened = `${title}\n\n${clean.text}${extras.attributeText ? `\n\n${extras.attributeText}` : ""}`;
  if (screened.length > MAX_SCREENED_TEXT) throw new HttpError(400, `the page has ${screened.length.toLocaleString("en-US")} characters of visible text; content moderation reads at most ${MAX_SCREENED_TEXT.toLocaleString("en-US")} a page, so it was not published (nothing was charged). Split it into several pages.`);
  if (extras.hosts.length > MAX_LINK_HOSTS) throw new HttpError(400, `the page links to ${extras.hosts.length} different sites; at most ${MAX_LINK_HOSTS} can be checked a page, so it was not published (nothing was charged). Split it into several pages.`);
  // The list reads cost nothing, the model calls do: links first.
  const checks = await Promise.all(extras.hosts.map(async (host) => ({ host, verdict: await linkCheck(host).catch(() => null) })));
  const bad = checks.filter((c) => c.verdict?.listed).map((c) => c.host);
  if (bad.length) throw new HttpError(422, `the page was not published: it links to ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ` and ${bad.length - 5} more` : ""}, listed as phishing (Phishing.Database, MetaMask eth-phishing-detect); nothing was charged`, "PAGE_REFUSED");
  let verdict: Awaited<ReturnType<Moderate>> = { flagged: false, categories: [] };
  // One piece at a time, and no further once one is flagged: a refused page costs no more calls than it has to.
  for (const chunk of screenChunks(screened)) { verdict = await moderate(chunk); if (verdict.flagged) break; }
  if (verdict.flagged) throw new HttpError(422, `the page was not published: content moderation flagged ${verdict.categories.map((c) => c.name).join(", ") || "it"}; nothing was charged`, "PAGE_REFUSED");
  const days = Math.min(MAX_DAYS, Math.max(1, input.days ?? MAX_DAYS));
  const now = new Date();
  const page: Page = { title, html: clean.html, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(), bytes: clean.html.length };
  const id = newId();
  await kv.put(`page:${id}`, JSON.stringify(page), { expirationTtl: days * 86_400 });
  return { id, url: `${origin}/p/${id}`, title, bytes: page.bytes, expiresAt: page.expiresAt, days, removed: ["script", "style", "iframe", "form", "event handlers", "javascript: links"], notice: "Published for the publisher's own use; noindex; removal requests to the support address on /support." };
}

export const readPage = async (kv: Kv | null, id: string): Promise<Page | null> => {
  if (!kv || !/^[a-z0-9]{12}$/.test(id)) return null;
  const raw = await kv.get(`page:${id}`);
  return raw ? (JSON.parse(raw) as Page) : null;
};

/** The served page: our chrome around the sanitised body, with the publish date, expiry and the abuse address. */
export function pageHtml(page: Page, mail: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(page.title)}</title><style>body{margin:0;font:16px/1.55 system-ui,sans-serif;color:#1b1b1b;background:#fff}main{max-width:52rem;margin:0 auto;padding:1.5rem 1rem}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.3rem .5rem}pre{overflow:auto;background:#f4f4f4;padding:.6rem}footer{max-width:52rem;margin:2rem auto;padding:1rem;border-top:1px solid #ddd;color:#555;font-size:.85rem}</style></head><body><main>${page.html}</main><footer>Published by an AI agent through Agent Data Tools on ${page.createdAt.slice(0, 10)}; this page expires on ${page.expiresAt.slice(0, 10)}. The content is the publisher's, not ours. Report a problem: ${esc(mail)}.</footer></body></html>`;
}

export const PAGES: Entry[] = [
  entry("/page/publish", "Host a web page, publish HTML: a URL for your agent's output",
    "Publish an HTML page and get a public URL for it (valid up to 7 days): send the HTML (up to 200,000 characters) and an optional title; the page is sanitised (no scripts, styles, frames, forms or event handlers; links and https images stay), screened by content moderation, stored, and served at /p/<id> with noindex. Use to hand a person a report, table or summary your agent produced, or to share results between agents. Removal requests: /support.",
    ["host-web-page", "publish-html", "static-site-hosting", "share-page", "agent-output", "web-page"], {
      html: { type: "string", description: "The HTML to publish (body content or a full document), up to 200,000 characters", required: true, example: "<h1>Weekly report</h1><p>Sales rose 12%.</p><table><tr><th>Region</th><th>Change</th></tr><tr><td>EU</td><td>+12%</td></tr></table>" },
      title: { type: "string", description: "Page title (default: the first line of text)", example: "Weekly report" },
      days: { type: "string", description: "Days the page stays online, 1 to 7 (default 7)", example: "7" },
    },
    { id: "k7m2p9qxw4rt", url: `${PUBLIC_ORIGIN}/p/k7m2p9qxw4rt`, title: "Weekly report", bytes: 131, expiresAt: "2026-11-07T12:00:00.000Z", days: 7, removed: ["script", "style", "iframe", "form", "event handlers", "javascript: links"], notice: "Published for the publisher's own use; noindex; removal requests to the support address on /support." },
    async (env, q) => publishPage(env.TRIALS ?? null, { html: need(q, "html", MAX_HTML), title: opt(q, "title", MAX_TITLE), days: num(q, "days", { min: 1, max: MAX_DAYS, fallback: MAX_DAYS, integer: true }) },
      async (text) => guardVerdict(String((await runAi<{ response?: unknown }>(env, GUARD_MODEL, { messages: [{ role: "user", content: text }] }))?.response ?? "")), env.PAGE_ORIGIN ?? PUBLIC_ORIGIN),
    "$0.01"), // every tool is at most $0.01 (the owner, 25 Oct 2026)
];
