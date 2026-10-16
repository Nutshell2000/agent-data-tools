import { Parser } from "htmlparser2";
import { HttpError } from "./env";
import { fencedCode } from "./markdown";
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
const concealed = (n: Node) =>
  "hidden" in n.attrs ||
  n.attrs["aria-hidden"] === "true" ||
  /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(n.attrs.style ?? "") ||
  /(?:^|\s)cookie[-_](?:banner|notice|consent)(?:$|\s)/i.test(
    n.attrs.class ?? "",
  );
const hidden = (n: Node) => skip.has(n.tag) || concealed(n);
const imageAlt = (n: Node) => n.attrs.alt === undefined ? null : squash(n.attrs.alt);
const imageLabel = (n: Node) => { const alt=imageAlt(n); return alt ? `[Image alt text: ${alt}]` : ""; };
const raw = (n: Node, includeImageAlt = false): string => {
  if (includeImageAlt && n.tag === "img") return imageLabel(n);
  return n.children.map(c=>typeof c === "string" ? c : hidden(c) ? "" : raw(c,includeImageAlt)).join("");
};
const longestTicks = (s: string) => {
  let longest = 0;
  for (const m of s.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return longest;
};
const escape = (s: string) => s.replace(/[\\`*_[\]<>|~]/g, "\\$&");

/** Inert, bounded HTML parsing. No scripts, layout or external subrequests. */
export function pageContent(html: string, base: string, maxChars: number, sectionId?: string) {
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
  const parents = new Map<Node, Node>();
  const scan = (n: Node) => {
    if (hidden(n)) return;
    visible.push(n);
    for (const c of n.children) if (typeof c !== "string") { parents.set(c,n); scan(c); }
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
    .map((n) => ({ n, length: squash(raw(n,true)).length }))
    .filter((v) => v.length > 0);
  candidates.sort(
    (a, b) =>
      Number(b.n.tag === "main" || b.n.attrs.role === "main") -
        Number(a.n.tag === "main" || a.n.attrs.role === "main") ||
      b.length - a.length,
  );
  const selected =
    candidates[0]?.n ?? visible.find((n) => n.tag === "body") ?? root;
  let renderRoot = selected;
  let section: { id: string; title: string | null; kind: "heading" | "container"; headingLevel: number | null } | null = null;
  if (sectionId !== undefined) {
    const primary: Node[] = [];
    const collect = (n: Node) => { if (hidden(n)) return; primary.push(n); for(const c of n.children) if(typeof c !== "string") collect(c); };
    collect(selected);
    const matches = primary.filter(n => n.attrs.id === sectionId);
    if (!matches.length) throw new HttpError(422, "Section ID was not found in visible primary content", "EXTRACTION_SECTION_NOT_FOUND");
    if (matches.length !== 1) throw new HttpError(422, "Section ID is ambiguous in visible primary content", "EXTRACTION_SECTION_AMBIGUOUS");
    let match = matches[0];
    // Documentation often puts an anchor ID inside a heading rather than on it.
    for (let ancestor: Node | undefined = match; ancestor; ancestor = parents.get(ancestor)) {
      if (/^h[1-6]$/.test(ancestor.tag)) { match = ancestor; break; }
      if (ancestor === selected) break;
    }
    if (/^h[1-6]$/.test(match.tag)) {
      const level = +match.tag[1];
      let active = false, stopped = false;
      const slice = (n: Node): Node | null => {
        if (stopped || concealed(n) || (hidden(n) && n.tag !== "svg")) return null;
        // Retain an inert marker so scoped output can report an uninterpreted diagram.
        if (n.tag === "svg") return active ? { ...n, children: [] } : null;
        if (n === match) active = true;
        else if (active && /^h[1-6]$/.test(n.tag) && +n.tag[1] <= level) { stopped = true; return null; }
        const children: (Node | string)[] = [];
        for (const child of n.children) {
          if (typeof child === "string") { if (active && !stopped) children.push(child); }
          else { const kept = slice(child); if (kept) children.push(kept); }
        }
        return children.length || n === match || (active && !stopped) ? { ...n, children } : null;
      };
      renderRoot = slice(selected)!;
      section = { id: sectionId, title: squash(raw(match)).slice(0,1000) || null, kind: "heading", headingLevel: level };
    } else if (["section", "article", "main", "div"].includes(match.tag)) {
      renderRoot = match;
      const findHeading = (n: Node): Node | undefined => {
        if(hidden(n)) return;
        if(/^h[1-6]$/.test(n.tag)) return n;
        for(const c of n.children) if(typeof c !== "string") { const found=findHeading(c); if(found) return found; }
      };
      const firstHeading = findHeading(match);
      section = { id: sectionId, title: firstHeading ? squash(raw(firstHeading)).slice(0,1000) || null : null, kind: "container", headingLevel: null };
    } else throw new HttpError(422, "Section ID must identify a heading, heading anchor, section, article, main or div", "EXTRACTION_SECTION_UNSUPPORTED");
  }
  // Protect literal blocks from prose cleanup. The prefix cannot occur in decoded source text.
  const decodedSource = raw(root,true);
  let prefix = "\uE000LITERAL";
  while (decodedSource.includes(prefix)) prefix += "X";
  const literals: string[] = [];
  const protect = (s: string) => `${prefix}${literals.push(s) - 1}\uE001`;
  const restore = (s: string): string =>
    s.replace(
      new RegExp(prefix + "(\\d+)\uE001", "g"),
      (_, id) => literals[Number(id)],
    );
  const forget = (s: string) => {
    for (const match of s.matchAll(new RegExp(prefix + "(\\d+)\uE001", "g")))
      literals[Number(match[1])] = "";
  };
  const tidy = (s: string) =>
    s
      .replace(/ *\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const warnings = new Set<string>();
  const inspectVisuals = (n: Node, inLiteralCode = false) => {
    if (concealed(n)) return;
    if (n.tag === "svg") { if(!["presentation","none"].includes(n.attrs.role)) warnings.add("visual_content_omitted"); return; }
    if (hidden(n)) return;
    if (n.tag === "canvas" && !["presentation","none"].includes(n.attrs.role)) warnings.add("visual_content_omitted");
    if (n.tag === "img") {
      if (inLiteralCode) warnings.add("images_in_literal_code_omitted");
      else if (imageAlt(n) === null) warnings.add("images_without_alt");
      else if (imageAlt(n)) warnings.add("image_alt_text_only");
    }
    for(const c of n.children) if(typeof c !== "string") inspectVisuals(c,inLiteralCode || n.tag === "pre");
  };
  inspectVisuals(renderRoot);
  if (semantic.length > 8) warnings.add("landmarks_limited");
  if (!candidates.length) warnings.add("body_fallback");
  const headings: { level: number; text: string; id: string | null }[] = [],
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
  ): { text: string; md: string } => {
    if (hidden(n)) return { text: "", md: "" };
    if (n.tag === "img") {
      const label=imageLabel(n);
      return label ? {text:` ${label} `,md:` ${escape(label)} `} : {text:"",md:""};
    }
    const languageHint =
      /(?:language|lang|highlight)-([\w+-]+)/
        .exec(n.attrs.class ?? "")?.[1]
        ?.slice(0, 64) ?? inheritedLanguage;
    if (n.tag === "pre") {
      const value = raw(n).replace(/\r\n?/g, "\n");
      const code = n.children.find(
        (c): c is Node => typeof c !== "string" && c.tag === "code",
      );
      const language =
        /(?:language|lang)-([\w+-]+)/
          .exec(code?.attrs.class ?? n.attrs.class ?? "")?.[1]
          ?.slice(0, 64) ?? languageHint;
      if (codeBlocks.length < 20 && budget > 0) {
        const text = detail(value, maxChars);
        codeBlocks.push({
          language,
          text,
          truncated: text.length < value.length,
        });
      } else warnings.add("details_truncated");
      return {
        text: "\n\n" + protect(value) + "\n\n",
        md: "\n\n" + protect(fencedCode(value, language)) + "\n\n",
      };
    }
    if (n.tag === "table") {
      const bodyRows: string[][] = [],
        bodyHeaders: number[] = [];
      let hasSpans = false;
      // Cell markup carries word boundaries even when source HTML has no whitespace.
      // Keep the established single-line cell contract while retaining those boundaries.
      const cellContent = (cell: Node): string => {
        if (hidden(cell)) return "";
        if (cell.tag === "img") return ` ${imageLabel(cell)} `;
        if (cell.tag === "br" || cell.tag === "hr") return " ";
        const value = cell.children.map(c => typeof c === "string" ? c : cellContent(c)).join("");
        return block.has(cell.tag) || /^h[1-6]$/.test(cell.tag) || ["tr", "td", "th", "li", "pre"].includes(cell.tag)
          ? ` ${value} ` : value;
      };
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
          if (
            cells.some(
              (c) =>
                Number(c.attrs.colspan ?? 1) > 1 ||
                Number(c.attrs.rowspan ?? 1) > 1,
            )
          )
            hasSpans = true;
          if (cells.some((c) => c.tag === "th"))
            bodyHeaders.push(bodyRows.length);
          bodyRows.push(cells.map((c) => squash(cellContent(c))));
        } else for (const c of v.children) if (typeof c !== "string") visit(c);
      };
      visit(n);
      const cap = n.children.find(
        (c): c is Node => typeof c !== "string" && c.tag === "caption",
      );
      const bodyCaption = cap ? squash(cellContent(cap)) : null;
      // Structured details cannot consume the primary-content budget.
      if (tables.length < 20) {
        let truncated =
          bodyRows.length > 100 || bodyRows.some((r) => r.length > 20);
        const rows: string[][] = [];
        for (const row of bodyRows.slice(0, 100)) {
          if (budget <= 0) {
            truncated = true;
            break;
          }
          rows.push(
            row.slice(0, 20).map((s) => {
              const v = detail(s, 2000);
              if (v.length < s.length) truncated = true;
              return v;
            }),
          );
        }
        const caption = bodyCaption === null ? null : detail(bodyCaption, 500);
        if (caption !== bodyCaption) truncated = true;
        tables.push({
          caption,
          rows,
          headerRows: bodyHeaders.filter((i) => i < rows.length),
          hasSpans,
          truncated,
        });
        if (truncated) warnings.add("details_truncated");
      } else warnings.add("details_truncated");
      if (hasSpans) warnings.add("table_spans_present");
      const width = bodyRows[0]?.length ?? 0;
      const line = (r: string[]) => "| " + r.map(escape).join(" | ") + " |";
      const mdRows = bodyHeaders.includes(0)
        ? bodyRows
        : [Array(width).fill(""), ...bodyRows];
      const tsv = bodyRows.map((r) => r.join("\t")).join("\n");
      let md = "";
      if (width && !hasSpans && bodyRows.every((r) => r.length === width)) {
        md = [
          line(mdRows[0]),
          line(Array(width).fill("---")),
          ...mdRows.slice(1).map(line),
        ].join("\n");
      } else if (tsv) {
        warnings.add("table_shape_preserved_as_tsv");
        md = fencedCode(tsv, "tsv");
      }
      return {
        text: `\n\n${bodyCaption ? bodyCaption + "\n" : ""}${protect(tsv)}\n\n`,
        md: `\n\n${bodyCaption ? escape(bodyCaption) + "\n\n" : ""}${protect(md)}\n\n`,
      };
    }
    if (n.tag === "ul" || n.tag === "ol") {
      const items = n.children.filter(
        (c): c is Node => typeof c !== "string" && c.tag === "li" && !hidden(c),
      );
      const validOrdinal = (s: string | undefined) =>
        s !== undefined &&
        /^-?\d+$/.test(s) &&
        Number.isSafeInteger(Number(s)) &&
        Math.abs(Number(s)) < 1_000_000;
      const reversed = "reversed" in n.attrs;
      let ordinal = validOrdinal(n.attrs.start)
        ? Number(n.attrs.start)
        : reversed
          ? items.length
          : 1;
      const text: string[] = [],
        md: string[] = [];
      for (const item of items) {
        if (validOrdinal(item.attrs.value)) ordinal = Number(item.attrs.value);
        const marker = n.tag === "ol" ? `${ordinal}.` : "-";
        ordinal += reversed ? -1 : 1;
        const rendered = render(item, languageHint);
        const indent = " ".repeat(marker.length + 1);
        const format = (s: string) => {
          const lines = restore(tidy(s)).split("\n");
          return (
            marker +
            " " +
            lines[0] +
            lines
              .slice(1)
              .map((line) => "\n" + (line ? indent + line : ""))
              .join("")
          );
        };
        text.push(format(rendered.text));
        md.push(format(rendered.md));
        // Parent lists now own these strings; do not retain a full copy at every nesting level.
        forget(rendered.text);
        forget(rendered.md);
      }
      return {
        text: "\n\n" + protect(text.join("\n")) + "\n\n",
        md: "\n\n" + protect(md.join("\n")) + "\n\n",
      };
    }
    const children = n.children.map((c) =>
      typeof c === "string"
        ? { text: c.replace(/\s+/g, " "), md: escape(c.replace(/\s+/g, " ")) }
        : render(c, languageHint),
    );
    let text = children.map((c) => c.text).join(""),
      md = children.map((c) => c.md).join("");
    if (/^h[1-6]$/.test(n.tag)) {
      const sourceId = n.attrs.id ?? n.children.find((c): c is Node => typeof c !== "string" && c.tag === "a" && Boolean(c.attrs.id))?.attrs.id;
      const id = sourceId && sourceId.length <= 500 && !/[\u0000-\u001f\u007f]/.test(sourceId) && detail(sourceId,500) === sourceId ? sourceId : null;
      if (headings.length < 100)
        headings.push({
          level: +n.tag[1],
          text: detail(squash(restore(text)), 1000),
          id,
        });
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
          links.push({ href, text: detail(squash(restore(text)), 200) });
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
        text,
        md,
      };
    if (n.tag === "br" || n.tag === "hr") return { text: "\n", md: "\n" };
    if (block.has(n.tag)) {
      text = `\n\n${text}\n\n`;
      md = `\n\n${md}\n\n`;
    }
    return { text, md };
  };
  const rendered = render(renderRoot);
  const text = restore(tidy(rendered.text)),
    markdown = restore(tidy(rendered.md));
  if (!text.trim())
    throw new HttpError(
      422,
      "No readable static content; the page may require JavaScript or visual interpretation",
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
    section,
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
