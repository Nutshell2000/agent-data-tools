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
  if (!marks.length) return /class="ti-art"/.test(html) ? parseOldLayout(html, title) : parsePlainLayout(html);
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

/**
 * The older Official Journal layout (the consolidated Treaties of 2016: TEU, TFEU, Charter): no eli-subdivision divs,
 * each article opens with <p class="ti-art">Article N</p> and an optional <p class="sti-art"> heading. The document goes
 * on with protocols and declarations that number their articles from 1 again, so articles are read while their numbers
 * rise. No recitals.
 */
function parseOldLayout(html, title) {
  const heads = [...html.matchAll(/<p[^>]*class="ti-art"[^>]*>([\s\S]*?)<\/p>/gi)];
  const items = [];
  let last = 0;
  for (let i = 0; i < heads.length; i++) {
    const label = plain(heads[i][1]).replace(/\n/g, " ");
    const m = /(\d+)\s*([a-z]?)\s*$/i.exec(label);
    if (!m) continue;
    const n = Number(m[1]);
    if (n <= last) break;
    last = n;
    let seg = html.slice(heads[i].index + heads[i][0].length, i + 1 < heads.length ? heads[i + 1].index : html.length);
    // Section and title headings between articles belong to what follows, not to this article's text.
    seg = seg.replace(/<p[^>]*class="(?:ti-section-\d|ti-grseq-\d|doc-ti)"[^>]*>[\s\S]*?<\/p>/gi, "");
    const hm = /^\s*(?:<[^>]+>\s*)*<p[^>]*class="sti-art"[^>]*>([\s\S]*?)<\/p>/i.exec(seg);
    const heading = hm ? plain(hm[1]).replace(/\n/g, " ") : null;
    if (hm) seg = seg.slice(hm.index + hm[0].length);
    const text = plain(seg);
    if (text.length < 20) continue;
    items.push({ kind: "article", num: `${n}${m[2].toLowerCase()}`, heading: heading && !/^\(ex /i.test(heading) ? heading : null, text });
  }
  // EUR-Lex has no per-article anchors in these documents: links go to the whole text.
  return { title, items, anchors: false };
}

/**
 * The plain HTML that CELLAR serves for older acts that have no XHTML rendition (Working Time Directive 2003/88/EC):
 * one <p> per line, "Article 7" alone on a line, then usually a short heading line. Recitals are the "(n)" lines between
 * "Whereas" and the enacting formula ("HAVE ADOPTED", in the document's language: any line in capitals ending with ":").
 * Articles are read while their numbers rise; the text ends at "Done at" or the annexes.
 */
export function parsePlainLayout(html) {
  const lines = plain(html).split("\n");
  const enact = lines.findIndex((l) => /^[A-ZÅÄÖÜÉ ,]{8,}:$/.test(l) && !/^WHEREAS/i.test(l));
  const start = enact >= 0 ? enact + 1 : 0;
  const items = [];
  for (let i = 0; i < Math.max(0, enact); i++) {
    const m = /^\((\d+)\)\s+(.*)$/.exec(lines[i]);
    if (m && m[2].length > 20) items.push({ kind: "recital", num: m[1], heading: null, text: lines[i] });
  }
  let last = 0;
  let cur = null;
  const isEnd = (l) => /^(Done at|Hecho en|Fait à|Geschehen zu|Utfärdad i|ANNEX|BILAGA|ANHANG|ANNEXE)\b/i.test(l);
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (isEnd(l)) break;
    const m = /^(?:Article|Artikel|Article premier|Artículo|Articolo)\s+(\d+)\s*([a-z]?)$/i.exec(l);
    if (m && Number(m[1]) === last + 1) {
      if (cur) items.push(cur);
      last = Number(m[1]);
      const next = lines[i + 1] ?? "";
      const isHeading = next.length > 0 && next.length < 140 && !/^(\d+\.|\([a-z0-9]+\))/i.test(next) && !/[.;:]$/.test(next);
      cur = { kind: "article", num: `${m[1]}${m[2].toLowerCase()}`, heading: isHeading ? next : null, text: "" };
      if (isHeading) i++;
      continue;
    }
    // Chapter and section titles (in capitals) between articles are not article text.
    if (cur && !/^(CHAPTER|SECTION|TITLE|KAPITEL|AVSNITT|AVDELNING)\b/.test(l) && !(/^[A-ZÅÄÖ0-9 \-,]{6,}$/.test(l) && l === l.toUpperCase())) cur.text = cur.text ? `${cur.text}\n${l}` : l;
  }
  if (cur) items.push(cur);
  return { title: null, items: items.filter((it) => it.text.length >= 20), anchors: false };
}

/**
 * Where a paragraph of an article starts: a line opening with its number ("1.", "2a.") counts only when it is the next
 * number after the previous paragraph, so numbered lists inside a paragraph are not taken for paragraphs. Returns the
 * paragraph number in force at the start of every line (null before the first numbered paragraph).
 */
export function paragraphOfLines(text) {
  let current = null;
  let expect = 1;
  return text.split("\n").map((line) => {
    const m = /^(\d+)([a-z]?)\.\s/.exec(line);
    if (m && (Number(m[1]) === expect || (m[2] && Number(m[1]) === expect - 1))) {
      current = m[1] + m[2];
      expect = Number(m[1]) + 1;
    }
    return current;
  });
}

/**
 * chunks() with the paragraph each part starts in: { text, para } where para is the article paragraph in force at the
 * part's first line (null before the first numbered paragraph). Answers use it to cite "Article 6(1)(f)", not "Article 6".
 */
export function chunksWithParagraph(text, max = 1600) {
  const paras = paragraphOfLines(text);
  const lines = text.split("\n");
  const parts = chunks(text, max);
  let line = 0;
  return parts.map((part) => {
    const first = part.split("\n")[0];
    // Parts are cut at line ends (or inside one overlong line): find the line this part starts on.
    let at = line;
    while (at < lines.length && !lines[at].startsWith(first.slice(0, 40)) && !first.startsWith(lines[at].slice(0, 40))) at++;
    if (at >= lines.length) at = line;
    line = at;
    // The paragraph in force before this line, unless the line itself opens one.
    return { text: part, para: paras[at] ?? null };
  });
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

