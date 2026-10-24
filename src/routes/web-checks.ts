// Website and DNS checks (1.57.0). Bazaar search on 24 Oct 2026, summed 30-day payers over the top 20, no listing of ours:
// uptime check 51, redirect checker 41, seo audit 41, dns propagation 38, dns records 35, keyword density 60.
// Every outbound page request goes through parseTarget (no private, loopback or credentialed targets), hop by hop.
import { entry, need, num, opt, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { capBytes, parseTarget } from "../lib/fetch";
import { htmlToText } from "./utils";

const U = ["web", "utility"];
const UA = "Mozilla/5.0 (compatible; AgentDataTools/1.0; +https://agent-data-tools.revmesh2074.workers.dev)";

// ---------- redirects and status ----------
export interface Hop { url: string; status: number; location?: string; ms: number }
/** Follows redirects one hop at a time (manual), validating every target before it is requested. */
export async function walk(start: string, maxHops = 10, method: "GET" | "HEAD" = "GET") {
  let current = parseTarget(start);
  const hops: Hop[] = [];
  const seen = new Set<string>();
  const signal = AbortSignal.timeout(9_000);
  for (;;) {
    if (seen.has(current.href)) return { hops, final: current.href, loop: true, response: null as Response | null };
    seen.add(current.href);
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(current.href, { method, redirect: "manual", signal, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (hops.length === 0) throw new HttpError(timeout ? 504 : 502, timeout ? "the site did not answer within 9 seconds" : "the site could not be reached (DNS, TLS or connection failure)");
      return { hops, final: current.href, loop: false, response: null, error: timeout ? "timeout" : "unreachable" };
    }
    const location = res.headers.get("location");
    // A hop without a Location leaves the key out (the published schema types it as a string).
    hops.push({ url: current.href, status: res.status, ...(location ? { location } : {}), ms: Date.now() - t0 });
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      if (hops.length > maxHops) return { hops, final: current.href, loop: false, response: null, error: `more than ${maxHops} redirects` };
      let next: URL;
      try { next = new URL(location, current); } catch { return { hops, final: current.href, loop: false, response: null, error: "invalid redirect location" }; }
      try { current = parseTarget(next.href); } catch { return { hops, final: next.href, loop: false, response: null, error: "redirects to a private or unsupported address (not followed)" }; }
      continue;
    }
    return { hops, final: current.href, loop: false, response: res };
  }
}

async function readCapped(res: Response, limit: number) {
  let truncated = false;
  const bytes = new Uint8Array(await new Response(capBytes(res.body!, limit, () => { truncated = true; })).arrayBuffer());
  return { text: new TextDecoder().decode(bytes), bytes: bytes.byteLength, truncated };
}

// ---------- DNS ----------
const TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "CAA", "SRV", "PTR", "DS", "DNSKEY", "HTTPS"] as const;
const TYPE_NUM: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, DS: 43, DNSKEY: 48, HTTPS: 65, CAA: 257 };
const RCODE: Record<number, string> = { 0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED" };
export const RESOLVERS = [
  { name: "Cloudflare", url: "https://cloudflare-dns.com/dns-query" },
  { name: "Google", url: "https://dns.google/resolve" },
  { name: "AdGuard", url: "https://dns.adguard-dns.com/resolve" },
  { name: "AliDNS", url: "https://dns.alidns.com/resolve" },
  { name: "DNSPod", url: "https://doh.pub/dns-query" },
] as const;
const HOSTNAME = /^(?=.{1,253}$)(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
export function hostInput(raw: string) {
  let h = raw.trim().toLowerCase();
  if (/^https?:\/\//.test(h)) { try { h = new URL(h).hostname; } catch { /* fall through to the check */ } }
  h = h.replace(/\.$/, "");
  if (!HOSTNAME.test(h)) throw new HttpError(400, "name must be a domain name such as example.com");
  return h;
}
type Doh = { Status: number; AD?: boolean; Answer?: { name: string; type: number; TTL: number; data: string }[] };
export async function dohQuery(url: string, name: string, type: string): Promise<Doh> {
  const res = await fetch(`${url}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Doh;
}
const answersOf = (r: Doh, type: string) => (r.Answer ?? []).filter((a) => a.type === TYPE_NUM[type]).map((a) => ({ data: a.data.replace(/\.$/, ""), ttl: a.TTL }));

// ---------- SEO ----------
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((x) => x !== undefined) ?? null;
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
const metaContent = (html: string, key: string, by = "name") => { const t = tags(html, "meta").find((m) => (attr(m, by) ?? "").toLowerCase() === key); return t ? attr(t, "content") : null; };
const clean = (s: string) => htmlToText(s).replace(/\s+/g, " ").trim();
export function seoAudit(html: string, pageUrl: string) {
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const titleText = title ? clean(title) : null;
  const description = metaContent(html, "description");
  const canonical = tags(html, "link").map((l) => ((attr(l, "rel") ?? "").toLowerCase() === "canonical" ? attr(l, "href") : null)).find(Boolean) ?? null;
  const robots = metaContent(html, "robots");
  const h1 = (body.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? []).map((h) => clean(h)).filter(Boolean);
  const h2 = (body.match(/<h2\b/gi) ?? []).length;
  const imgs = tags(body, "img");
  // A bare `alt` (or alt="") marks a decorative image and is valid; only a missing attribute counts.
  const noAlt = imgs.filter((i) => !/\salt(\s*=|[\s/>])/i.test(i)).length;
  const lang = attr(tags(html, "html")[0] ?? "", "lang");
  const viewport = metaContent(html, "viewport");
  const og = { title: metaContent(html, "og:title", "property"), description: metaContent(html, "og:description", "property"), image: metaContent(html, "og:image", "property") };
  const twitterCard = metaContent(html, "twitter:card");
  const jsonLd = (html.match(/<script[^>]+type\s*=\s*["']application\/ld\+json["']/gi) ?? []).length;
  const host = new URL(pageUrl).hostname;
  let internal = 0, external = 0;
  for (const a of tags(body, "a")) {
    const href = attr(a, "href");
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    try { (new URL(href, pageUrl).hostname === host ? internal++ : external++); } catch { /* skip bad links */ }
  }
  const words = clean(body).split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
  const issues: string[] = [];
  if (!titleText) issues.push("missing <title>"); else if (titleText.length < 30 || titleText.length > 60) issues.push(`title is ${titleText.length} characters (30-60 is usual)`);
  if (!description) issues.push("missing meta description"); else if (description.length < 70 || description.length > 160) issues.push(`meta description is ${description.length} characters (70-160 is usual)`);
  if (h1.length === 0) issues.push("no <h1>"); else if (h1.length > 1) issues.push(`${h1.length} <h1> elements (one is usual)`);
  if (!canonical) issues.push("no canonical link");
  if (robots && /noindex/i.test(robots)) issues.push("meta robots says noindex");
  if (noAlt) issues.push(`${noAlt} of ${imgs.length} images have no alt text`);
  if (!lang) issues.push("<html> has no lang attribute");
  if (!viewport) issues.push("no viewport meta tag (mobile)");
  if (!og.title || !og.image) issues.push("missing Open Graph title or image (social previews)");
  if (jsonLd === 0) issues.push("no JSON-LD structured data");
  if (words < 300) issues.push(`thin content: about ${words} words`);
  const checks = 11;
  return {
    score: Math.round(((checks - Math.min(checks, issues.length)) / checks) * 100), issues,
    title: titleText, titleLength: titleText?.length ?? 0, description, descriptionLength: description?.length ?? 0, canonical, robots,
    h1, h2Count: h2, images: imgs.length, imagesWithoutAlt: noAlt, lang, viewport: !!viewport, openGraph: og, twitterCard, jsonLdBlocks: jsonLd,
    links: { internal, external }, wordCount: words,
  };
}

// ---------- keyword density ----------
const STOP = new Set("a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves also may one new us get use used using via per".split(" "));
export function keywordDensity(text: string, top: number) {
  const words = (text.toLowerCase().match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).map((w) => w.replace(/['’]s$/, ""));
  const total = words.length;
  if (total === 0) throw new HttpError(422, "no words found in the text");
  const count = (items: string[]) => { const m = new Map<string, number>(); for (const k of items) m.set(k, (m.get(k) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  const content = words.filter((w) => w.length > 2 && !STOP.has(w));
  const pairs: string[] = [];
  for (let i = 0; i + 1 < words.length; i++) if (!STOP.has(words[i]) && !STOP.has(words[i + 1]) && words[i].length > 2 && words[i + 1].length > 2) pairs.push(`${words[i]} ${words[i + 1]}`);
  const pct = (n: number) => Math.round((n / total) * 10_000) / 100;
  return {
    totalWords: total, uniqueWords: new Set(words).size,
    keywords: count(content).slice(0, top).map(([word, n]) => ({ word, count: n, densityPct: pct(n) })),
    phrases: count(pairs).filter(([, n]) => n > 1).slice(0, top).map(([phrase, n]) => ({ phrase, count: n, densityPct: pct(n) })),
  };
}

export const WEB_CHECKS: Entry[] = [
  entry("/url/redirects", "Redirect checker, URL unshortener: the full redirect chain",
    "Follow a URL's redirects hop by hop (up to 10) and return every hop's status code and Location, the final URL, total hops, timing and whether it loops. Expands short links (bit.ly, t.co…) to their destination without loading the page. Every hop is checked before it is requested; redirects to private addresses are reported, not followed. Use to unshorten a link, check an HTTPS or www redirect, or debug SEO redirect chains.",
    ["redirect-checker", "url-unshortener", "redirects", "seo", ...U], { url: { type: "string", description: "Absolute http(s) URL", required: true, example: "http://github.com" } },
    { url: "http://github.com", finalUrl: "https://github.com/", finalStatus: 200, redirects: 1, loop: false, hops: [{ url: "http://github.com/", status: 301, location: "https://github.com/", ms: 40 }, { url: "https://github.com/", status: 200, ms: 120 }], error: null },
    async (_e, q) => {
      const url = need(q, "url", 2_000);
      const w = await walk(url, 10, "GET");
      await w.response?.body?.cancel();
      const last = w.hops.at(-1)!;
      return { url, finalUrl: w.final, finalStatus: w.response ? last.status : null, redirects: Math.max(0, w.hops.length - (w.response ? 1 : 0)), loop: w.loop, hops: w.hops, error: (w as { error?: string }).error ?? (w.loop ? "redirect loop" : null) };
    }),

  entry("/url/uptime", "Uptime check, website status: is it up and how fast",
    "Check whether a website is up right now: one live request (following redirects) with the HTTP status, up or down, response time in ms, the final URL, content type, server header and page size, and optionally whether the page contains a given text. Timeouts and connection failures come back as down with the reason, not as an error. Use for uptime monitoring, health checks before calling an API, or to confirm a deploy.",
    ["uptime-check", "website-status", "monitoring", "http", ...U], {
      url: { type: "string", description: "Absolute http(s) URL", required: true, example: "https://www.wikipedia.org/" },
      contains: { type: "string", description: "Optional text that must appear in the page (first 500 KB)", example: "Wikipedia" },
    },
    { url: "https://www.wikipedia.org/", up: true, status: 200, responseMs: 180, finalUrl: "https://www.wikipedia.org/", redirects: 0, contentType: "text/html", server: "ATS", bytes: 75000, contains: { text: "Wikipedia", found: true }, checkedAt: "2026-10-24T09:00:00.000Z", reason: null },
    async (_e, q) => {
      const url = need(q, "url", 2_000);
      const want = opt(q, "contains", 200);
      const checkedAt = new Date().toISOString();
      const t0 = Date.now();
      let w: Awaited<ReturnType<typeof walk>>;
      try { w = await walk(url, 10, "GET"); }
      catch (e) {
        if (e instanceof HttpError && (e.status === 504 || e.status === 502)) return { url, up: false, status: null, responseMs: Date.now() - t0, finalUrl: null, redirects: 0, contentType: null, server: null, bytes: null, contains: want ? { text: want, found: false } : null, checkedAt, reason: e.message };
        throw e;
      }
      const res = w.response;
      if (!res) { const last = w.hops.at(-1); return { url, up: false, status: last?.status ?? null, responseMs: Date.now() - t0, finalUrl: w.final, redirects: w.hops.length, contentType: null, server: null, bytes: null, contains: want ? { text: want, found: false } : null, checkedAt, reason: (w as { error?: string }).error ?? "redirect loop" }; }
      const body = await readCapped(res, 500_000);
      const ms = Date.now() - t0;
      return {
        url, up: res.status < 400, status: res.status, responseMs: ms, finalUrl: w.final, redirects: w.hops.length - 1,
        contentType: res.headers.get("content-type")?.split(";")[0] ?? null, server: res.headers.get("server"), bytes: body.bytes,
        contains: want ? { text: want, found: body.text.toLowerCase().includes(want.toLowerCase()) } : null, checkedAt, reason: res.status >= 400 ? `HTTP ${res.status}` : null,
      };
    }),

  entry("/dns/lookup", "DNS records lookup: A, AAAA, MX, TXT, CNAME, NS and more",
    "Look up DNS records of a domain over DNS-over-HTTPS (Cloudflare 1.1.1.1): A, AAAA, CNAME, MX, NS, TXT, SOA, CAA, SRV, PTR, DS, DNSKEY or HTTPS, with each answer's TTL, the response code (NOERROR, NXDOMAIN…) and whether DNSSEC validated. Use to check email (MX, SPF in TXT), verify a domain, or debug a DNS change; for whether the change has spread use dns_propagation.",
    ["dns-records", "dns-lookup", "dns", "domain", ...U], {
      name: { type: "string", description: "Domain name (or a URL; its host is used)", required: true, example: "example.com" },
      type: { type: "string", description: `Record type: ${TYPES.join(", ")} (default A)`, example: "MX" },
    },
    { name: "example.com", type: "MX", status: "NOERROR", dnssec: true, answers: [{ data: "0 .", ttl: 86400 }], resolver: "Cloudflare" },
    async (_e, q) => {
      const name = hostInput(need(q, "name", 300));
      const type = pick(q, "type", TYPES.map((t) => t.toLowerCase()) as unknown as readonly string[], "a").toUpperCase();
      let r: Doh;
      try { r = await dohQuery(RESOLVERS[0].url, name, type); } catch { throw new HttpError(502, "the DNS resolver did not answer; try again"); }
      return { name, type, status: RCODE[r.Status] ?? String(r.Status), dnssec: !!r.AD, answers: answersOf(r, type), resolver: "Cloudflare" };
    }),

  entry("/dns/propagation", "DNS propagation check: answers from 5 resolvers worldwide",
    "Check whether a DNS change has propagated: the same record queried at five public resolvers (Cloudflare, Google, AdGuard, AliDNS and DNSPod), each resolver's answers and TTLs, whether they all agree, and the majority answer. Record types A, AAAA, CNAME, MX, NS, TXT, CAA. Use to see where an old value is still cached after changing a record, moving hosting or setting up email; for one lookup use dns_lookup.",
    ["dns-propagation", "dns", "domain", "monitoring", ...U], {
      name: { type: "string", description: "Domain name (or a URL; its host is used)", required: true, example: "example.com" },
      type: { type: "string", description: "Record type: A, AAAA, CNAME, MX, NS, TXT or CAA (default A)", example: "A" },
    },
    { name: "example.com", type: "A", propagated: true, majority: ["93.184.215.14"], resolvers: [{ resolver: "Cloudflare", status: "NOERROR", answers: ["93.184.215.14"], ttl: 300, error: null }] },
    async (_e, q) => {
      const name = hostInput(need(q, "name", 300));
      const type = pick(q, "type", ["a", "aaaa", "cname", "mx", "ns", "txt", "caa"] as const, "a").toUpperCase();
      const rows = await Promise.all(RESOLVERS.map(async (r) => {
        try {
          const d = await dohQuery(r.url, name, type);
          const a = answersOf(d, type);
          return { resolver: r.name, status: RCODE[d.Status] ?? String(d.Status), answers: a.map((x) => x.data).sort(), ttl: a.length ? Math.min(...a.map((x) => x.ttl)) : null, error: null as string | null };
        } catch { return { resolver: r.name, status: null, answers: [] as string[], ttl: null, error: "did not answer" }; }
      }));
      const answered = rows.filter((r) => !r.error);
      if (!answered.length) throw new HttpError(502, "no resolver answered; try again");
      const key = (r: { status: string | null; answers: string[] }) => `${r.status}|${r.answers.join(",")}`;
      const tally = new Map<string, number>();
      for (const r of answered) tally.set(key(r), (tally.get(key(r)) ?? 0) + 1);
      const best = [...tally].sort((a, b) => b[1] - a[1])[0][0];
      return { name, type, propagated: tally.size === 1, agreeing: tally.get(best)!, answered: answered.length, majority: answered.find((r) => key(r) === best)!.answers, resolvers: rows };
    }),

  entry("/seo/audit", "SEO audit of a page: title, meta, headings, links and issues",
    "On-page SEO audit of one URL: title and meta description with their lengths, canonical, meta robots, H1s and H2 count, images without alt text, lang and viewport, Open Graph and Twitter card tags, JSON-LD blocks, internal and external link counts and word count, plus a list of issues and a 0-100 score. Reads the server's HTML (no JavaScript), up to 1 MB. Use to check a page before publishing or to compare competitors.",
    ["seo-audit", "seo", "meta-tags", "website", ...U], { url: { type: "string", description: "Absolute http(s) URL of the page", required: true, example: "https://www.wikipedia.org/" } },
    { url: "https://www.wikipedia.org/", finalUrl: "https://www.wikipedia.org/", status: 200, score: 64, issues: ["no canonical link"], title: "Wikipedia", titleLength: 9, description: "Wikipedia is a free online encyclopedia…", descriptionLength: 120, canonical: null, robots: null, h1: ["Wikipedia The Free Encyclopedia"], h2Count: 1, images: 2, imagesWithoutAlt: 0, lang: "en", viewport: true, openGraph: { title: null, description: null, image: null }, twitterCard: null, jsonLdBlocks: 0, links: { internal: 30, external: 300 }, wordCount: 1500 },
    async (_e, q) => {
      const url = need(q, "url", 2_000);
      const w = await walk(url, 10, "GET");
      const res = w.response;
      if (!res) throw new HttpError(422, `the page did not load: ${(w as { error?: string }).error ?? "redirect loop"}`);
      if (res.status >= 400) { await res.body?.cancel(); throw new HttpError(422, `the page answered HTTP ${res.status}`); }
      if (!/html/i.test(res.headers.get("content-type") ?? "")) { await res.body?.cancel(); throw new HttpError(422, "the URL is not an HTML page"); }
      const body = await readCapped(res, 1_000_000);
      return { url, finalUrl: w.final, status: res.status, ...seoAudit(body.text, w.final), truncated: body.truncated };
    }),

  entry("/text/keyword-density", "Keyword density: top keywords and phrases of a text or page",
    "Keyword density of a text or a web page: the most frequent words and two-word phrases (English stop words removed), each with its count and share of all words, plus total and unique word counts. Give text, or a URL whose readable text is used (HTML, up to 1 MB). Use for SEO copy checks, comparing a page against a target keyword, or summarising what a page is about; for readability use text_stats.",
    ["keyword-density", "seo", "keywords", "text", ...U], {
      text: { type: "string", description: "The text (up to 50,000 characters); or give url instead", example: "Agents pay per call. Agents pay with USDC. Pay per call tools for agents." },
      url: { type: "string", description: "A page URL to analyse instead of text", example: "https://en.wikipedia.org/wiki/Search_engine_optimization" },
      top: { type: "integer", description: "How many keywords and phrases to return, 1-50 (default 15)", example: 15 },
    },
    { source: "text", totalWords: 14, uniqueWords: 7, keywords: [{ word: "agents", count: 3, densityPct: 21.43 }, { word: "pay", count: 3, densityPct: 21.43 }], phrases: [{ phrase: "pay per", count: 2, densityPct: 14.29 }] },
    async (_e, q) => {
      const top = num(q, "top", { min: 1, max: 50, fallback: 15, integer: true });
      const text = opt(q, "text", 50_000);
      if (text) return { source: "text", ...keywordDensity(text, top) };
      const url = opt(q, "url", 2_000);
      if (!url) throw new HttpError(400, "give text or url");
      const w = await walk(url, 10, "GET");
      const res = w.response;
      if (!res || res.status >= 400) { await res?.body?.cancel(); throw new HttpError(422, "the page did not load"); }
      const body = await readCapped(res, 1_000_000);
      const plain = /html/i.test(res.headers.get("content-type") ?? "") ? htmlToText(body.text) : body.text;
      return { source: w.final, ...keywordDensity(plain, top) };
    }),
];
