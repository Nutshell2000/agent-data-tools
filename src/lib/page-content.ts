import { Parser } from "htmlparser2";
import { HttpError } from "./env";
type Node = {
  tag: string;
  attrs: Record<string, string>;
  children: (Node | string)[];
};
const skip = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "nav",
  "footer",
  "aside",
  "form",
  "button",
  "select",
]);
const block = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "blockquote",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
]);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const hidden = (n: Node) =>
  skip.has(n.tag) ||
  "hidden" in n.attrs ||
  n.attrs["aria-hidden"] === "true" ||
  /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(n.attrs.style ?? "") ||
  /(?:^|\s)cookie[-_](?:banner|notice|consent)(?:$|\s)/i.test(
    n.attrs.class ?? "",
  );
const raw = (n: Node): string =>
  n.children
    .map((c) => (typeof c === "string" ? c : hidden(c) ? "" : raw(c)))
    .join("");
const longestTicks = (s: string) => {
  let longest = 0;
  for (const m of s.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return longest;
};
const escape = (s: string) => s.replace(/[\\`*_[\]<>|]/g, "\\$&");

/** Inert, bounded HTML parsing. No scripts, layout or external subrequests. */
export function pageContent(html: string, base: string, maxChars: number) {
  const root: Node = { tag: "root", attrs: {}, children: [] },
    stack = [root],
    all: Node[] = [];
  let count = 0;
  new Parser(
    {
      onopentag(tag, attrs) {
        if (++count > 20000 || stack.length > 128)
          throw new HttpError(
            422,
            "HTML complexity limit exceeded",
            "EXTRACTION_COMPLEXITY",
          );
        const n: Node = { tag, attrs, children: [] };
        stack[stack.length - 1].children.push(n);
        stack.push(n);
        all.push(n);
      },
      ontext(s) {
        stack[stack.length - 1].children.push(s);
      },
      onclosetag() {
        if (stack.length > 1) stack.pop();
      },
    },
    { decodeEntities: true },
  ).end(html);
  const safeUrl = (v?: string) => {
    if (!v || v.length > 4096) return null;
    try {
      const u = new URL(v, base);
      return /^https?:$/.test(u.protocol) && !u.username && !u.password
        ? u.href
        : null;
    } catch {
      return null;
    }
  };
  const visible: Node[] = [];
  const scan = (n: Node) => {
    if (hidden(n)) return;
    visible.push(n);
    for (const c of n.children) if (typeof c !== "string") scan(c);
  };
  scan(root);
  const titleNode = all.find((n) => n.tag === "title");
  const title = titleNode ? squash(raw(titleNode)).slice(0, 1000) : null;
  if (
    /just a moment|attention required|access denied/i.test(title ?? "") &&
    all.some((n) =>
      /challenge-running|cf-chl|challenge-platform/i.test(
        [n.attrs.id, n.attrs.src, n.attrs.class].join(" "),
      ),
    )
  )
    throw new HttpError(
      422,
      "Source returned a browser challenge; static content is unavailable",
      "EXTRACTION_BLOCKED",
    );
  const semantic = visible.filter(
    (n) => n.tag === "main" || n.tag === "article" || n.attrs.role === "main",
  );
  // Bound repeated subtree reads on adversarially nested landmarks.
  const candidates = semantic
    .slice(0, 8)
    .map((n) => ({ n, length: squash(raw(n)).length }))
    .filter((v) => v.length > 0);
  candidates.sort(
    (a, b) =>
      Number(b.n.tag === "main" || b.n.attrs.role === "main") -
        Number(a.n.tag === "main" || a.n.attrs.role === "main") ||
      b.length - a.length,
  );
  const selected =
    candidates[0]?.n ?? visible.find((n) => n.tag === "body") ?? root;
  const warnings = new Set<string>();
  if (semantic.length > 8) warnings.add("landmarks_limited");
  if (!candidates.length) warnings.add("body_fallback");
  const headings: { level: number; text: string }[] = [],
    links: { href: string; text: string }[] = [],
    codeBlocks: {
      language: string | null;
      text: string;
      truncated: boolean;
    }[] = [],
    tables: {
      caption: string | null;
      rows: string[][];
      headerRows: number[];
      hasSpans: boolean;
      truncated: boolean;
    }[] = [];
  let budget = Math.min(maxChars, 20000);
  const seen = new Set<string>();
  const detail = (s: string, limit: number) => {
    const v = s.slice(0, Math.min(limit, budget));
    budget -= v.length;
    if (v.length < s.length) warnings.add("details_truncated");
    return v;
  };
  const render = (
    n: Node,
    inheritedLanguage: string | null = null,
    listMarker = "-",
  ): { text: string; md: string } => {
    if (hidden(n)) return { text: "", md: "" };
    const languageHint =
      /(?:language|lang|highlight)-([\w+-]+)/.exec(n.attrs.class ?? "")?.[1] ??
      inheritedLanguage;
    if (n.tag === "pre") {
      const value = raw(n)
        .replace(/\r\n?/g, "\n")
        .replace(/^\n|\n$/g, "");
      const code = n.children.find(
        (c): c is Node => typeof c !== "string" && c.tag === "code",
      );
      const language =
        /(?:language|lang)-([\w+-]+)/.exec(
          code?.attrs.class ?? n.attrs.class ?? "",
        )?.[1] ?? languageHint;
      if (codeBlocks.length < 20 && budget > 0) {
        const text = detail(value, maxChars);
        codeBlocks.push({
          language,
          text,
          truncated: text.length < value.length,
        });
      } else warnings.add("details_truncated");
      const fence = "`".repeat(Math.max(3, longestTicks(value) + 1));
      return {
        text: "\n\n" + value + "\n\n",
        md: `\n\n${fence}${language ?? ""}\n${value}\n${fence}\n\n`,
      };
    }
    if (n.tag === "table") {
      if (tables.length >= 20) {
        warnings.add("details_truncated");
        return { text: "", md: "" };
      }
      const rows: string[][] = [],
        headerRows: number[] = [];
      let hasSpans = false,
        truncated = false;
      const visit = (v: Node) => {
        if (hidden(v)) return;
        if (v.tag === "table" && v !== n) {
          warnings.add("nested_table_omitted");
          return;
        }
        if (v.tag === "tr") {
          const cells = v.children.filter(
            (c): c is Node =>
              typeof c !== "string" && /^(td|th)$/.test(c.tag) && !hidden(c),
          );
          if (rows.length >= 100 || budget <= 0) {
            truncated = true;
            return;
          }
          if (
            cells.some(
              (c) =>
                Number(c.attrs.colspan ?? 1) > 1 ||
                Number(c.attrs.rowspan ?? 1) > 1,
            )
          )
            hasSpans = true;
          if (cells.length > 20) truncated = true;
          if (cells.some((c) => c.tag === "th")) headerRows.push(rows.length);
          rows.push(
            cells.slice(0, 20).map((c) => {
              const s = squash(raw(c)),
                out = detail(s, 2000);
              if (out.length < s.length) truncated = true;
              return out;
            }),
          );
        } else for (const c of v.children) if (typeof c !== "string") visit(c);
      };
      visit(n);
      const cap = n.children.find(
        (c): c is Node => typeof c !== "string" && c.tag === "caption",
      );
      const caption = cap ? detail(squash(raw(cap)), 500) : null;
      tables.push({ caption, rows, headerRows, hasSpans, truncated });
      if (hasSpans) warnings.add("table_spans_present");
      if (truncated) warnings.add("details_truncated");
      const width = Math.max(0, ...rows.map((r) => r.length));
      const line = (r: string[]) =>
        "| " +
        Array.from({ length: width }, (_, i) => escape(r[i] ?? "")).join(
          " | ",
        ) +
        " |";
      const mdRows = headerRows.includes(0)
        ? rows
        : [Array(width).fill(""), ...rows];
      const md = width
        ? [
            line(mdRows[0]),
            line(Array(width).fill("---")),
            ...mdRows.slice(1).map(line),
          ].join("\n")
        : "";
      return {
        text: `\n\n${caption ? caption + "\n" : ""}${rows.map((r) => r.join("\t")).join("\n")}\n\n`,
        md: `\n\n${caption ? escape(caption) + "\n\n" : ""}${md}\n\n`,
      };
    }
    const start = Number(n.attrs.start ?? 1);
    let ordinal =
      Number.isSafeInteger(start) && Math.abs(start) < 1_000_000 ? start : 1;
    const children = n.children.map((c) =>
      typeof c === "string"
        ? { text: c.replace(/\s+/g, " "), md: escape(c.replace(/\s+/g, " ")) }
        : render(
            c,
            languageHint,
            n.tag === "ol" && c.tag === "li" ? `${ordinal++}.` : "-",
          ),
    );
    let text = children.map((c) => c.text).join(""),
      md = children.map((c) => c.md).join("");
    if (n.tag === "ul" || n.tag === "ol") {
      text = text.replace(/\n\n(?=\S)/g, "\n");
      md = md.replace(/\n\n(?=(?:-|\d+\.) )/g, "\n");
    }
    if (/^h[1-6]$/.test(n.tag)) {
      if (headings.length < 100)
        headings.push({ level: +n.tag[1], text: detail(squash(text), 1000) });
      else warnings.add("headings_limited");
      return {
        text: `\n\n${text}\n\n`,
        md: `\n\n${"#".repeat(+n.tag[1])} ${md.trim()}\n\n`,
      };
    }
    if (n.tag === "a") {
      const href = safeUrl(n.attrs.href);
      if (href && !seen.has(href) && links.length < 200 && budget > 0) {
        seen.add(href);
        if (detail(href, 4096) === href)
          links.push({ href, text: detail(squash(text), 200) });
      } else if (href && !seen.has(href)) warnings.add("links_limited");
      if (href)
        md = `[${md.trim()}](${href.replace(/[()\\]/g, (c) => "\\" + c)})`;
    }
    if (n.tag === "code") {
      const fence = "`".repeat(Math.max(1, longestTicks(text) + 1));
      md = text.includes("`") ? `${fence} ${text} ${fence}` : "`" + text + "`";
    }
    if (n.tag === "strong" || n.tag === "b") md = `**${md}**`;
    if (n.tag === "em" || n.tag === "i") md = `*${md}*`;
    if (n.tag === "li")
      return {
        text: `\n${text.trim()}\n`,
        md: `\n${listMarker} ${md.trim()}\n`,
      };
    if (n.tag === "br" || n.tag === "hr") return { text: "\n", md: "\n" };
    if (block.has(n.tag)) {
      text = `\n\n${text}\n\n`;
      md = `\n\n${md}\n\n`;
    }
    return { text, md };
  };
  const rendered = render(selected);
  const clean = (s: string) =>
    s
      .replace(/ *\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const text = clean(rendered.text),
    markdown = clean(rendered.md);
  if (!text)
    throw new HttpError(
      422,
      "No readable static content; the page may require JavaScript",
      "EXTRACTION_EMPTY",
    );
  const meta = (name: string) =>
    all
      .find(
        (n) =>
          n.tag === "meta" &&
          (n.attrs.name ?? n.attrs.property)?.toLowerCase() === name,
      )
      ?.attrs.content?.slice(0, 2000) ?? null;
  return {
    title: title ?? meta("og:title"),
    description: meta("description") ?? meta("og:description"),
    lang: all.find((n) => n.tag === "html")?.attrs.lang?.slice(0, 100) ?? null,
    canonical: safeUrl(
      all.find(
        (n) =>
          n.tag === "link" &&
          n.attrs.rel?.toLowerCase().split(/\s+/).includes("canonical"),
      )?.attrs.href,
    ),
    headings,
    links,
    tables,
    codeBlocks,
    contentSelection: candidates.length
      ? selected.tag === "article"
        ? "article"
        : "main"
      : "body",
    warnings: [...warnings],
    text,
    markdown,
  };
}
