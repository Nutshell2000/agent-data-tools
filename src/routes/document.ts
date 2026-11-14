// Office documents to text (14 Nov 2026). Word (.docx), Excel (.xlsx) and PowerPoint (.pptx) files are ZIP archives
// of XML; they are read here, inside the Worker, with lib/zip.ts and the saxes XML parser, so there is no upstream
// service and no per-call cost beyond CPU. A PDF is read with the PDF tool's reader, so one tool takes whatever
// file a workflow hands over. Why: research of 14 Nov (reports\Focused API product for 10k monthly.md): inside
// automation tools the installs go to document conversion, and people there hold files of every kind.
import { SaxesParser } from "saxes";
import { entry, need, num, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { fetchFile } from "../lib/fetch";
import { FILE_REF_INPUT, heldFile, isFileRef } from "../lib/file-input";
import { isZip, zipEntries, zipText, type ZipEntry } from "../lib/zip";
import { readPdf } from "./pdf";
import { CHAT_MODEL, extractFields, fieldNames } from "./ai-text";

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** The most one XML part may expand to, and all parts of one file together. */
const PART_LIMIT = 40 * 1024 * 1024;
const TOTAL_LIMIT = 80 * 1024 * 1024;
const MAX_SHEETS = 20;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 50;
const MAX_SLIDES = 300;
/** How much of a document the extraction model reads. */
export const EXTRACT_CHARS = 24_000;

type Format = "text" | "markdown";
export type DocumentType = "docx" | "xlsx" | "pptx" | "pdf";

/** Walks an XML part: element names without their prefix handling (office XML is read by its literal names). */
function walk(xml: string, on: { open?: (name: string, attributes: Record<string, string>) => void; text?: (text: string) => void; close?: (name: string) => void }) {
  const parser = new SaxesParser({ xmlns: false });
  let error: string | undefined;
  parser.on("error", (e) => { error ??= e.message; });
  parser.on("doctype", () => { error ??= "DOCTYPE"; });
  parser.on("opentag", (tag) => on.open?.(tag.name, tag.attributes as Record<string, string>));
  parser.on("text", (t) => on.text?.(t));
  parser.on("cdata", (t) => on.text?.(t));
  parser.on("closetag", (tag) => on.close?.(tag.name));
  try { parser.write(xml).close(); } catch (e) { error ??= (e as Error).message; }
  if (error) throw new HttpError(422, "a part of the file is not well-formed XML");
}

const cell = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
const tableMarkdown = (rows: string[][]) => {
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? "")).join(" | ")} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
};
const tableText = (rows: string[][]) => rows.map((r) => r.map((c) => c.replace(/\s*\n\s*/g, " ").trim()).join("\t")).join("\n");

/** Word: paragraphs, headings, list items and tables of the main document part, in order. */
export function docxText(xml: string, format: Format): string {
  const blocks: string[] = [];
  // A table may sit inside a table cell: each open table has its rows, and a paragraph belongs to the innermost cell.
  const tables: { rows: string[][]; row: string[] | null; cell: string[] | null }[] = [];
  let para: string[] | null = null;
  let style = "";
  let listed = false;
  let inText = false;
  let skip = 0; // deleted text and field codes are not part of what the reader sees
  walk(xml, {
    open(name, a) {
      if (name === "w:del" || name === "w:instrText" || name === "w:delText") skip++;
      else if (name === "w:tbl") tables.push({ rows: [], row: null, cell: null });
      else if (name === "w:tr") { const t = tables.at(-1); if (t) t.row = []; }
      else if (name === "w:tc") { const t = tables.at(-1); if (t) t.cell = []; }
      else if (name === "w:p") { para = []; style = ""; listed = false; }
      else if (name === "w:pStyle") style = a["w:val"] ?? "";
      else if (name === "w:numPr") listed = true;
      else if (name === "w:t") inText = true;
      else if (name === "w:tab" && para) para.push("\t");
      else if ((name === "w:br" || name === "w:cr") && para) para.push("\n");
    },
    text(t) { if (inText && skip === 0 && para) para.push(t); },
    close(name) {
      if (name === "w:del" || name === "w:instrText" || name === "w:delText") skip--;
      else if (name === "w:t") inText = false;
      else if (name === "w:p" && para) {
        const text = para.join("").replace(/[ \t]+\n/g, "\n").trim();
        para = null;
        const table = tables.at(-1);
        if (table?.cell) { if (text) table.cell.push(text); return; }
        if (!text) return;
        const heading = /^(?:heading|rubrik|titre|überschrift|berschrift)\s*([1-6])$/i.exec(style.replace(/[-_]/g, " ").replace(/([a-z])(\d)/i, "$1 $2"));
        if (format === "markdown" && /^title$/i.test(style)) blocks.push(`# ${text}`);
        else if (format === "markdown" && heading) blocks.push(`${"#".repeat(Number(heading[1]))} ${text}`);
        else if (listed) blocks.push(`- ${text}`);
        else blocks.push(text);
      } else if (name === "w:tc") { const t = tables.at(-1); if (t?.row && t.cell) { t.row.push(t.cell.join("\n")); t.cell = null; } }
      else if (name === "w:tr") { const t = tables.at(-1); if (t?.row) { if (t.row.some((c) => c !== "")) t.rows.push(t.row); t.row = null; } }
      else if (name === "w:tbl") {
        const t = tables.pop();
        if (!t || t.rows.length === 0) return;
        const rendered = format === "markdown" ? tableMarkdown(t.rows) : tableText(t.rows);
        const outer = tables.at(-1);
        if (outer?.cell) outer.cell.push(tableText(t.rows)); else blocks.push(rendered);
      }
    },
  });
  // Consecutive list items stay together; everything else is separated by a blank line.
  return blocks.reduce((out, block, i) => out + (i === 0 ? "" : block.startsWith("- ") && blocks[i - 1].startsWith("- ") ? "\n" : "\n\n") + block, "");
}

/** Column letters of a cell reference ("BC12") as a zero-based index. */
const columnIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); }
  return n - 1;
};

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  let item: string[] | null = null;
  let inText = false;
  let phonetic = 0;
  walk(xml, {
    open(name) { if (name === "si") item = []; else if (name === "rPh") phonetic++; else if (name === "t") inText = true; },
    text(t) { if (inText && phonetic === 0 && item) item.push(t); },
    close(name) { if (name === "t") inText = false; else if (name === "rPh") phonetic--; else if (name === "si" && item) { out.push(item.join("")); item = null; } },
  });
  return out;
}

function sheetRows(xml: string, strings: string[]): { rows: string[][]; cut: boolean } {
  const rows: string[][] = [];
  let row: string[] | null = null;
  let ref = "";
  let type = "";
  let value: string[] | null = null;
  let reading = false;
  let cut = false;
  walk(xml, {
    open(name, a) {
      if (name === "row") { if (rows.length >= MAX_ROWS) { cut = true; row = null; } else row = []; }
      else if (name === "c") { ref = a.r ?? ""; type = a.t ?? ""; value = []; }
      else if (name === "v" || name === "t") reading = true;
    },
    text(t) { if (reading && value) value.push(t); },
    close(name) {
      if (name === "v" || name === "t") reading = false;
      else if (name === "c" && row && value) {
        const raw = value.join("");
        value = null;
        const text = type === "s" ? strings[Number(raw)] ?? "" : type === "b" ? (raw === "1" ? "TRUE" : "FALSE") : raw;
        const at = ref ? columnIndex(ref) : row.length;
        if (at < 0 || at >= MAX_COLUMNS) { if (text !== "") cut = true; return; }
        while (row.length < at) row.push("");
        row[at] = text;
      } else if (name === "row" && row) { while (row.length && row.at(-1) === "") row.pop(); if (row.length) rows.push(row); row = null; }
    },
  });
  return { rows, cut };
}

/** Excel: each sheet as a table. Cached values as stored; a date is the number Excel keeps, as the note says. */
async function xlsxText(bytes: Uint8Array, entries: Map<string, ZipEntry>, format: Format, read: (name: string) => Promise<string | null>) {
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new HttpError(422, "the workbook has no sheet list");
  const sheets: { name: string; id: string }[] = [];
  walk(workbook, { open(name, a) { if (name === "sheet" && sheets.length < 200) sheets.push({ name: a.name ?? `Sheet ${sheets.length + 1}`, id: a["r:id"] ?? "" }); } });
  const targets = new Map<string, string>();
  const rels = await read("xl/_rels/workbook.xml.rels");
  if (rels) walk(rels, { open(name, a) { if (name === "Relationship" && a.Id && a.Target) targets.set(a.Id, a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target}`); } });
  const strings = sharedStrings(await read("xl/sharedStrings.xml"));
  const parts: string[] = [];
  const summary: { name: string; rows: number; columns: number }[] = [];
  let cut = sheets.length > MAX_SHEETS;
  for (const [i, sheet] of sheets.slice(0, MAX_SHEETS).entries()) {
    const xml = await read(targets.get(sheet.id) ?? `xl/worksheets/sheet${i + 1}.xml`);
    if (!xml) continue; // a chart sheet or a missing part
    const { rows, cut: sheetCut } = sheetRows(xml, strings);
    cut ||= sheetCut;
    summary.push({ name: sheet.name, rows: rows.length, columns: rows.reduce((n, r) => Math.max(n, r.length), 0) });
    if (rows.length === 0) continue;
    parts.push(format === "markdown" ? `## ${sheet.name}\n\n${tableMarkdown(rows)}` : `${sheet.name}\n${tableText(rows)}`);
  }
  void bytes; void entries;
  return { text: parts.join("\n\n"), sheets: summary, cut };
}

/** PowerPoint: the text of each slide, in slide order. */
async function pptxText(entries: Map<string, ZipEntry>, format: Format, read: (name: string) => Promise<string | null>) {
  const numbers = [...entries.keys()].map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n)?.[1]).filter((n): n is string => Boolean(n)).map(Number).sort((a, b) => a - b);
  const parts: string[] = [];
  for (const n of numbers.slice(0, MAX_SLIDES)) {
    const xml = await read(`ppt/slides/slide${n}.xml`);
    if (!xml) continue;
    const paragraphs: string[] = [];
    let para: string[] | null = null;
    let inText = false;
    walk(xml, {
      open(name) { if (name === "a:p") para = []; else if (name === "a:t") inText = true; else if (name === "a:br" && para) para.push("\n"); },
      text(t) { if (inText && para) para.push(t); },
      close(name) { if (name === "a:t") inText = false; else if (name === "a:p" && para) { const text = para.join("").trim(); if (text) paragraphs.push(text); para = null; } },
    });
    parts.push(`${format === "markdown" ? `## Slide ${n}` : `Slide ${n}`}\n\n${paragraphs.join("\n")}`.trim());
  }
  return { text: parts.join("\n\n"), slides: numbers.length, cut: numbers.length > MAX_SLIDES };
}

/** What kind of file the bytes are, read from the bytes and never from a name or a content type. */
export function documentType(bytes: Uint8Array, entries: Map<string, ZipEntry> | null): DocumentType | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (!entries) return null;
  if (entries.has("word/document.xml")) return "docx";
  if (entries.has("xl/workbook.xml")) return "xlsx";
  if (entries.has("ppt/presentation.xml")) return "pptx";
  return null;
}

export async function readDocument(bytes: Uint8Array, format: Format, maxChars: number) {
  const entries = isZip(bytes) ? zipEntries(bytes) : null;
  const type = documentType(bytes, entries);
  if (!type) {
    const old = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    throw new HttpError(415, old
      ? "this is an old binary Office file (.doc, .xls or .ppt); save it as .docx, .xlsx or .pptx and send that (nothing was charged)"
      : "the file is not a Word (.docx), Excel (.xlsx), PowerPoint (.pptx) or PDF file (nothing was charged)");
  }
  let budget = TOTAL_LIMIT;
  const read = async (name: string) => {
    const text = await zipText(bytes, entries!, name, Math.min(PART_LIMIT, budget));
    if (text !== null) budget -= text.length;
    return text;
  };
  let text: string;
  let extra: Record<string, unknown> = {};
  let cut = false;
  if (type === "pdf") {
    const pdf = await readPdf(bytes, 1, 200, maxChars);
    text = pdf.pages.map((p) => p.text).join("\n\n");
    extra = { pages: pdf.totalPages };
    cut = pdf.truncated;
  } else if (type === "docx") {
    text = docxText((await read("word/document.xml"))!, format);
  } else if (type === "xlsx") {
    const sheet = await xlsxText(bytes, entries!, format, read);
    text = sheet.text;
    extra = { sheets: sheet.sheets, note: "Cells hold the values the file stores: a formula's last calculated result, and dates as Excel's day numbers." };
    cut = sheet.cut;
  } else {
    const deck = await pptxText(entries!, format, read);
    text = deck.text;
    extra = { slides: deck.slides };
    cut = deck.cut;
  }
  text = text.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new HttpError(422, "the file holds no text (nothing was charged)");
  const truncated = cut || text.length > maxChars;
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return { type, format: type === "pdf" ? "text" as const : format, chars: text.length, truncated, ...extra, text };
}

export const DOCUMENT: Entry[] = [
  entry("/document/text", "Document to text: Word, Excel, PowerPoint, PDF",
    "Convert a document to text or Markdown: Word (.docx) with headings, lists and tables, Excel (.xlsx) with each sheet as a table, PowerPoint (.pptx) slide by slide, or a PDF's text layer. Give the URL of a public file, or send the file itself in a POST body (up to 10 MB). Old .doc/.xls/.ppt, scanned and password-protected files fail uncharged. Use to read attachments, reports and spreadsheets into an agent, RAG or a workflow.",
    ["docx-to-text", "word-to-markdown", "xlsx-to-json", "document", "pptx", "office", "rag"], {
      url: { type: "string", description: "Absolute public http(s) URL of the file (or send the file in a POST body instead)", required: true, example: "https://calibre-ebook.com/downloads/demos/demo.docx" },
      format: { type: "string", description: "markdown (default: headings, lists and tables kept) or text", enum: ["markdown", "text"], example: "markdown" },
      maxChars: { type: "integer", description: "Maximum characters of text returned (1000-200000, default 50000)", example: 1000 },
    },
    {
      url: "https://calibre-ebook.com/downloads/demos/demo.docx",
      type: "docx", format: "markdown", chars: 1000, truncated: true,
      text: "# Demonstration of DOCX support in calibre\n\nThis document demonstrates the ability of the calibre DOCX Input plugin to convert the various typographic features in a Microsoft Word (2007 and newer) document.",
    },
    async (_env, q) => {
      const format = pick(q, "format", ["markdown", "text"] as const, "markdown");
      const maxChars = num(q, "maxChars", { min: 1000, max: 200_000, fallback: 50_000, integer: true });
      const sent = q(FILE_REF_INPUT);
      if (isFileRef(sent)) {
        const bytes = heldFile(sent);
        if (!bytes) throw new HttpError(400, "send the file in a POST body (raw bytes, a multipart `file` part, or base64 in JSON); a file reference cannot be used in a GET");
        return { url: null, source: "upload", bytes: bytes.byteLength, ...(await readDocument(bytes, format, maxChars)) };
      }
      const file = await fetchFile(q("url"), /^/, DOCUMENT_MAX_BYTES, "a document", { cacheSeconds: 600, budgetMs: 20_000 });
      return { url: file.url, ...(await readDocument(file.bytes, format, maxChars)) };
      // $0.005, the PDF tool's price (the owner delegated prices on 14 Nov 2026: "you decide prices").
    }, "$0.005"),

  // Named fields out of a document (14 Nov 2026): the file is read as above and the fields are found by the chat model.
  // Why: "the invoice number, total and due date of this attachment" is the job automation builders bring a document
  // tool, and sellers price it per document, far above plain text. One Workers AI call per document; AI_DAILY_CAP
  // bounds the bill. The model reads at most EXTRACT_CHARS characters, and the answer says when the file held more.
  entry("/document/extract", "Extract data from a document: invoice, receipt, contract fields as JSON",
    "Extract named fields from a document as JSON: give a PDF, Word (.docx), Excel (.xlsx) or PowerPoint (.pptx) file by URL or in a POST body (up to 10 MB) and the field names you want, such as invoice_number, total, due_date. An AI model reads the file's text and returns one JSON object, with null where a value is not stated. Scanned files without text fail uncharged. Use to turn invoices, receipts, orders and contracts into rows.",
    ["invoice-parser", "document-extraction", "pdf-to-json", "invoice-ocr", "data-extraction", "document", "ai"], {
      url: { type: "string", description: "Absolute public http(s) URL of the file (or send the file in a POST body instead)", required: true, example: "https://calibre-ebook.com/downloads/demos/demo.docx" },
      fields: { type: "string", description: "Comma-separated field names to extract (1-30)", required: true, example: "title,product_name,supported_formats" },
    },
    {
      url: "https://calibre-ebook.com/downloads/demos/demo.docx",
      type: "docx", data: { title: "Demonstration of DOCX support in calibre", product_name: "calibre", supported_formats: "AZW3, EPUB" },
      missing: [], charsRead: 9617, truncated: false, model: CHAT_MODEL,
    },
    async (env, q) => {
      const fields = fieldNames(need(q, "fields", 1000));
      const sent = q(FILE_REF_INPUT);
      let bytes: Uint8Array;
      let url: string | null = null;
      if (isFileRef(sent)) {
        const held = heldFile(sent);
        if (!held) throw new HttpError(400, "send the file in a POST body (raw bytes, a multipart `file` part, or base64 in JSON) with fields in the query; a file reference cannot be used in a GET");
        bytes = held;
      } else {
        const file = await fetchFile(q("url"), /^/, DOCUMENT_MAX_BYTES, "a document", { cacheSeconds: 600, budgetMs: 20_000 });
        bytes = file.bytes;
        url = file.url;
      }
      // Plain text for the model: Markdown table rules add characters and no information.
      const doc = await readDocument(bytes, "text", EXTRACT_CHARS);
      const found = await extractFields(env, doc.text, fields, CHAT_MODEL, 900);
      return { url, ...(url ? {} : { source: "upload" }), type: doc.type, ...found, charsRead: doc.chars, truncated: doc.truncated };
      // $0.03 a document: one model call, and a tenth to a half of what document-extraction sellers charge (14 Nov 2026).
    }, "$0.03"),
];
