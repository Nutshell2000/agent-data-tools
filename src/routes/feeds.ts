// Content retrieval helpers: RSS/Atom feed reading and link-preview metadata.
// Feeds and page metadata are published for others to read, so there is no licence to clear.
// Both fetch through the public-fetch guard (no private hosts, redirects re-validated, capped bytes).
import { Parser } from "htmlparser2";
import { entry, num, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { capBytes, fetchPublic, parseTarget } from "../lib/fetch";

const FEED_BYTES = 2 * 1024 * 1024;
const PAGE_BYTES = 512 * 1024;

const clean = (s: string, max: number) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const absolute = (href: string | undefined, base: string) => {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
};
const isoDate = (s: string) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toISOString();
};

async function fetchText(raw: string | undefined, accept: string, maxBytes: number, cacheSeconds = 0) {
  const target = parseTarget(raw);
  const res = await fetchPublic(target, accept, [], { cacheSeconds });
  const text = await new Response(capBytes(res.body!, maxBytes, () => {})).text();
  return { finalUrl: res.url || target.href, contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim(), text };
}

interface FeedItem { title: string | null; link: string | null; date: string | null; summary: string | null; author: string | null; id: string | null }

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom leniently; unknown elements are ignored. */
export function parseFeed(xml: string, base: string, limit: number) {
  const feed: { title: string | null; link: string | null; description: string | null } = { title: null, link: null, description: null };
  const items: FeedItem[] = [];
  const stack: string[] = [];
  let cur: (FeedItem & { content?: string }) | null = null;
  let text = "";
  let format: "rss" | "atom" | null = null;
  const parent = () => stack[stack.length - 2];
  new Parser({
    onopentag(raw, attrs) {
      const name = raw.toLowerCase();
      stack.push(name);
      text = "";
      if (name === "rss" || name === "rdf:rdf") format ??= "rss";
      if (name === "feed") format ??= "atom";
      if (name === "item" || name === "entry") cur = { title: null, link: null, date: null, summary: null, author: null, id: null };
      if (name === "link" && attrs.href && (attrs.rel ?? "alternate") === "alternate") {
        const href = absolute(attrs.href, base);
        if (cur && parent() === "entry") cur.link ??= href;
        else if (!cur && parent() === "feed") feed.link ??= href;
      }
    },
    ontext(t) { text += t; },
    onclosetag(raw) {
      const name = raw.toLowerCase();
      const t = text.trim();
      const p = parent();
      if (cur && (p === "item" || p === "entry") && t) {
        if (name === "title") cur.title ??= clean(t, 300);
        else if (name === "link") cur.link ??= absolute(t, base);
        else if (["pubdate", "published", "updated", "dc:date"].includes(name)) cur.date ??= isoDate(t);
        else if (name === "description" || name === "summary") cur.summary ??= clean(t, 500);
        else if (name === "content" || name === "content:encoded") cur.content ??= clean(t, 500);
        else if (name === "guid" || name === "id") cur.id ??= t.slice(0, 500);
        else if (name === "author" || name === "dc:creator") cur.author ??= clean(t, 200);
      } else if (cur && name === "name" && p === "author" && t) {
        cur.author ??= clean(t, 200);
      } else if (!cur && (p === "channel" || p === "feed") && t) {
        if (name === "title") feed.title ??= clean(t, 300);
        else if (name === "link") feed.link ??= absolute(t, base);
        else if (name === "description" || name === "subtitle") feed.description ??= clean(t, 500);
      }
      if ((name === "item" || name === "entry") && cur) {
        const { content, ...item } = cur;
        if (items.length < limit) items.push({ ...item, summary: item.summary ?? content ?? null });
        cur = null;
      }
      stack.pop();
      text = "";
    },
  }, { xmlMode: true, decodeEntities: true }).end(xml);
  return { format, feed, items };
}

/** Title, description, OpenGraph and Twitter-card fields from a page's head. */
export function parseMeta(html: string, base: string) {
  const meta: Record<string, string> = {};
  const icons: string[] = [];
  let title = "", inTitle = false, canonical: string | null = null, lang: string | null = null, done = false;
  new Parser({
    onopentag(name, attrs) {
      if (done) return;
      if (name === "html" && attrs.lang) lang = attrs.lang.slice(0, 20);
      if (name === "title") inTitle = true;
      if (name === "meta") {
        const key = (attrs.property ?? attrs.name ?? attrs["http-equiv"] ?? "").toLowerCase();
        if (key && attrs.content !== undefined && Object.keys(meta).length < 100) meta[key] ??= attrs.content.slice(0, 1000);
      }
      if (name === "link" && attrs.href) {
        const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
        if (rel.includes("canonical")) canonical ??= absolute(attrs.href, base);
        if (rel.includes("icon") || rel.includes("apple-touch-icon")) {
          const icon = absolute(attrs.href, base);
          if (icon) icons.push(icon);
        }
      }
      if (name === "body") done = true;
    },
    ontext(t) { if (inTitle && !done) title += t; },
    onclosetag(name) {
      if (name === "title") inTitle = false;
      if (name === "head") done = true;
    },
  }, { decodeEntities: true }).end(html);
  const og = Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith("og:")).slice(0, 30));
  const tw = Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith("twitter:")).slice(0, 20));
  return {
    title: clean(meta["og:title"] ?? title, 300) || null,
    description: clean(meta.description ?? meta["og:description"] ?? meta["twitter:description"] ?? "", 1000) || null,
    siteName: meta["og:site_name"] ?? null,
    type: meta["og:type"] ?? null,
    image: absolute(meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"], base),
    canonical, lang,
    author: meta.author ?? meta["article:author"] ?? null,
    publishedTime: meta["article:published_time"] ?? null,
    favicon: icons[0] ?? absolute("/favicon.ico", base),
    themeColor: meta["theme-color"] ?? null,
    openGraph: og, twitter: tw,
  };
}

export const FEEDS: Entry[] = [
  entry("/feed", "RSS feed reader: read an RSS or Atom feed",
    "Read a public RSS 2.0, RSS 1.0 or Atom feed and get the feed title, link and description plus its newest items: title, link, date (ISO 8601), short plain-text summary, author and id. Up to 50 items, feeds up to 2 MB. Lenient with real-world feeds; a page that is not a feed returns 422, uncharged. Use to follow news, blogs, release notes or podcasts without scraping pages.",
    ["rss", "atom", "feed", "news", "web", "monitoring"], {
      url: { type: "string", description: "Absolute public http(s) URL of the feed", required: true, example: "https://blog.cloudflare.com/rss/" },
      limit: { type: "integer", description: "Items to return (1-50, default 20)", example: 10 },
    },
    {
      url: "https://blog.cloudflare.com/rss/", format: "rss", title: "Cloudflare Blog", link: "https://blog.cloudflare.com/", description: "Technical deep dives, product news and research…", count: 1,
      items: [{ title: "An example post", link: "https://blog.cloudflare.com/…", date: "2026-10-17T16:00:00.000Z", summary: "A short plain-text summary…", author: "Cloudflare", id: "https://blog.cloudflare.com/…" }],
    },
    async (_env, q) => {
      const limit = num(q, "limit", { min: 1, max: 50, fallback: 20, integer: true });
      const page = await fetchText(q("url"), "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1", FEED_BYTES);
      const { format, feed, items } = parseFeed(page.text, page.finalUrl, limit);
      if (!format || (!items.length && !feed.title)) throw new HttpError(422, `url is not an RSS or Atom feed (content type ${page.contentType || "unknown"})`);
      return { url: page.finalUrl, format, title: feed.title, link: feed.link, description: feed.description, count: items.length, items };
    }, "$0.01"),

  entry("/url/meta", "Website metadata, link preview: title, description and images of a page",
    "Fetch a public web page's head and return link-preview metadata: title, description, site name, type, preview image, canonical URL, language, author, published time, favicon, theme colour, and every OpenGraph and Twitter-card field. Reads at most 512 KB and never runs JavaScript. Use to build link previews, label citations or check how a URL will unfurl before sharing it.",
    ["metadata", "opengraph", "web", "seo", "preview", "links"], {
      url: { type: "string", description: "Absolute public http(s) URL of the page", required: true, example: "https://github.com/" },
    },
    {
      url: "https://github.com/", finalUrl: "https://github.com/", title: "GitHub", description: "…",
      siteName: "GitHub", type: "object", image: "https://github.githubassets.com/…", canonical: "https://github.com/", lang: "en", author: null, publishedTime: null,
      favicon: "https://github.githubassets.com/…", themeColor: null, openGraph: { "og:site_name": "GitHub" }, twitter: { "twitter:card": "summary_large_image" },
    },
    async (_env, q) => {
      const page = await fetchText(q("url"), "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", PAGE_BYTES, 600); // page metadata changes slowly; a 429 from the target on a repeat read is wasted money
      if (!/html/i.test(page.contentType)) throw new HttpError(415, `url must point to an HTML page; got ${page.contentType || "an unknown type"}`);
      return { url: parseTarget(q("url")).href, finalUrl: page.finalUrl, ...parseMeta(page.text, page.finalUrl) };
    }, "$0.01"),
];
