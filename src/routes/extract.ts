import { HttpError } from "../lib/env";
import { capBytes, fetchPublic, parseTarget } from "../lib/fetch";

const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHARS = 20_000;
const MAX_CHARS = 100_000;
const MAX_LINKS = 200;
const MAX_HEADINGS = 100;

const SKIP = ["script", "style", "noscript", "template", "svg", "iframe", "nav", "footer", "aside", "form", "button", "select"];
const BLOCK = [
  "p", "div", "li", "ul", "ol", "br", "hr", "tr", "table", "blockquote", "pre",
  "section", "article", "main", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd", "figcaption",
];
const HEADINGS = ["h1", "h2", "h3"];

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™",
};
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
const squash = (s: string) => decode(s).replace(/\s+/g, " ").trim();

export async function extract(rawUrl: string | undefined, maxCharsParam?: string) {
  const target = parseTarget(rawUrl);
  const maxChars = Math.min(Math.max(Number(maxCharsParam) || DEFAULT_CHARS, 500), MAX_CHARS);

  const res = await fetchPublic(target, "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1");
  const contentType = res.headers.get("content-type") ?? "";
  const isHtml = /html|xml/i.test(contentType);
  if (!isHtml && !/^text\//i.test(contentType)) {
    throw new HttpError(415, `unsupported content type: ${contentType || "unknown"}`);
  }

  let truncated = false;
  const body = capBytes(res.body!, MAX_BYTES, () => (truncated = true));
  const base = { url: target.href, finalUrl: res.url || target.href, status: res.status, contentType };

  if (!isHtml) {
    const text = (await new Response(body).text()).trim();
    return {
      ...base, title: null, description: null, lang: null, canonical: null, headings: [],
      text: text.slice(0, maxChars), textLength: text.length,
      truncated: truncated || text.length > maxChars, links: [], fetchedAt: new Date().toISOString(),
    };
  }

  const meta: Record<string, string> = {};
  const headings: { level: number; text: string }[] = [];
  const links: { href: string; text: string }[] = [];
  const seenLinks = new Set<string>();
  const parts: string[] = [];
  let chars = 0;
  let skip = 0;
  let title = "";
  let inTitle = false;
  let lang: string | null = null;
  let canonical: string | null = null;
  let heading: { level: number; text: string } | null = null;
  let link: { href: string; text: string } | null = null;

  // Text inside <main>/<article> is kept separately and preferred when present,
  // which drops most site chrome.
  const mainParts: string[] = [];
  let mainChars = 0;
  let mainDepth = 0;
  const budget = maxChars * 4; // headroom for whitespace collapsing

  const push = (s: string) => {
    if (chars < budget) {
      parts.push(s);
      chars += s.length;
    }
    if (mainDepth > 0 && mainChars < budget) {
      mainParts.push(s);
      mainChars += s.length;
    }
  };

  let rewriter = new HTMLRewriter()
    .on("html", { element: (el) => void (lang = el.getAttribute("lang")) })
    .on("title", {
      element(el) {
        if (title) return; // SVG <title> elements later in the page
        inTitle = true;
        el.onEndTag(() => void (inTitle = false));
      },
    })
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("name") ?? el.getAttribute("property"))?.toLowerCase();
        const content = el.getAttribute("content");
        if (key && content && !(key in meta)) meta[key] = squash(content);
      },
    })
    .on("link", {
      element(el) {
        if (el.getAttribute("rel")?.toLowerCase() === "canonical") canonical = el.getAttribute("href");
      },
    })
    .on("a", {
      element(el) {
        const href = el.getAttribute("href");
        if (!href || skip > 0 || links.length >= MAX_LINKS) return;
        let abs: string;
        try {
          abs = new URL(href, base.finalUrl).href;
        } catch {
          return;
        }
        if (!/^https?:/.test(abs) || seenLinks.has(abs)) return;
        seenLinks.add(abs);
        const current = { href: abs, text: "" };
        link = current;
        el.onEndTag(() => {
          current.text = squash(current.text).slice(0, 200);
          links.push(current);
          if (link === current) link = null;
        });
      },
    });

  for (const tag of SKIP) {
    rewriter = rewriter.on(tag, {
      element(el) {
        skip++;
        el.onEndTag(() => void skip--);
      },
    });
  }
  for (const tag of BLOCK) {
    rewriter = rewriter.on(tag, {
      element(el) {
        if (skip > 0) return;
        if (tag === "main" || tag === "article") {
          mainDepth++;
          el.onEndTag(() => void mainDepth--);
        }
        push("\n");
        if (HEADINGS.includes(tag) && headings.length < MAX_HEADINGS) {
          const current = { level: Number(tag[1]), text: "" };
          heading = current;
          el.onEndTag(() => {
            current.text = squash(current.text);
            if (current.text) headings.push(current);
            if (heading === current) heading = null;
            push("\n");
          });
        }
      },
    });
  }
  rewriter = rewriter.onDocument({
    text(chunk) {
      if (inTitle) return void (title += chunk.text);
      if (skip > 0 || !chunk.text) return;
      push(chunk.text);
      if (heading) heading.text += chunk.text;
      if (link) link.text += chunk.text;
    },
  });

  await rewriter.transform(new Response(body, { headers: { "content-type": contentType } })).arrayBuffer();

  const clean = (chunks: string[]) =>
    decode(chunks.join(""))
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const mainText = clean(mainParts);
  const text = mainText.length >= 200 ? mainText : clean(parts);

  return {
    ...base,
    title: squash(title) || meta["og:title"] || null,
    description: meta["description"] ?? meta["og:description"] ?? null,
    lang,
    canonical,
    headings,
    text: text.slice(0, maxChars),
    textLength: text.length,
    truncated: truncated || text.length > maxChars,
    links,
    fetchedAt: new Date().toISOString(),
  };
}
