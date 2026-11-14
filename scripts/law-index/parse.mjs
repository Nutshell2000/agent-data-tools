// Parsing of CELLAR XHTML for the EU law index (scripts/law-index/build.mjs): both the Official Journal layout (oj-* classes)
// and the consolidated layout (title-article-norm, norm); each article and recital is a div.eli-subdivision with id art_N / rct_N.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m));
/** Markup to plain text: block ends become line breaks; amendment markers of consolidated texts (▼M1, ►C1, ◄) go. */
export function plain(html) {
  return decode(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|tr|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, ""))
    .replace(/[▼►][A-Z]\d*/g, "").replace(/[◄▼►]/g, "")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean)
    // A paragraph or point number stands on its own line in both layouts ("1.", "(a)", "(iv)"): join it to its text.
    .reduce((acc, l) => { const prev = acc.at(-1); if (prev !== undefined && /^(\d+[a-z]?\.|\([a-z0-9]{1,5}\)|[ivx]{1,5}\))$/i.test(prev)) acc[acc.length - 1] = `${prev} ${l}`; else acc.push(l); return acc; }, [])
    .join("\n");
}
export const textOf = (html, cls) => {
  const m = new RegExp(`<p[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</p>`, "i").exec(html);
  return m ? plain(m[1]).replace(/\n/g, " ") : null;
};

/** Article and recital passages of one act's XHTML (Official Journal or consolidated layout). */
export function parseAct(html) {
  const title = [...html.matchAll(/<p[^>]*class="(?:oj-doc-ti|title-doc-first|title-doc-last)"[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plain(m[1]).replace(/\n/g, " ")).join(" ").slice(0, 400) || null;
  // The enacting terms end where the annexes, signatures or final part begin.
  // Cut at the start of the tag that carries the marker, not inside it.
  const end = (() => { const m = /id="anx_|class="oj-final"|class="final"|class="oj-signatory"|class="signatory"/i.exec(html); return m ? html.lastIndexOf("<", m.index) : html.length; })();
  const body = html.slice(0, end);
  const marks = [...body.matchAll(/<div class="eli-subdivision" id="(art|rct)_([0-9a-z]+)"/gi)];
  const items = [];
  for (let i = 0; i < marks.length; i++) {
    const [, kind, num] = marks[i];
    let seg = body.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : body.length);
    const heading = kind === "art" ? textOf(seg, "oj-sti-art") ?? textOf(seg, "stitle-article-norm") : null;
    seg = seg
      .replace(/<p[^>]*class="(?:oj-ti-section-[12]|title-division-[12]|oj-ti-art|title-article-norm|oj-sti-art|stitle-article-norm)"[^>]*>[\s\S]*?<\/p>/gi, "");
    const text = plain(seg);
    if (text.length < 20) continue;
    items.push({ kind: kind === "art" ? "article" : "recital", num, heading, text });
  }
  return { title, items };
}

/** Passages of at most ~1,600 characters, cut at line ends; one article may give several parts. */
export function chunks(text, max = 1600) {
  if (text.length <= max + 400) return [text];
  const out = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > max) { out.push(cur); cur = ""; }
    if (line.length > max * 1.5) { for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max)); continue; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

