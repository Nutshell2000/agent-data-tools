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
import { extractFields, listFields } from "./ai-text";
import { Buffer } from "node:buffer";
import { MODELS, runAi } from "../lib/ai";
import type { Env } from "../lib/env";

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
/**
 * The model that finds the fields (Apache 2.0, about the same cost a call as the chat model). Chosen by measurement,
 * see lib/extract-hints.ts: with the same rules Llama 4 Scout got 46 of 57 invoice fields right, Llama 3.3 70B 48,
 * this one 52. It reasons before it answers, so it gets more output tokens than the answer needs.
 */
export const EXTRACT_MODEL = "@cf/openai/gpt-oss-120b";
/**
 * One word instead of a field list: `fields=invoice` asks for the fields an accounts-payable row needs. The names are
 * the ones lib/extract-hints.ts explains to the model, and the ones the Dify plugin and the n8n template send.
 */
export const FIELD_PRESETS: Readonly<Record<string, string>> = Object.freeze({
  invoice: "supplier_name,supplier_vat_number,supplier_address,customer_name,customer_vat_number,invoice_number,invoice_date,due_date,currency,subtotal,tax_amount,total,iban,payment_reference,line_items[description,quantity,unit_price,amount]",
  receipt: "merchant_name,merchant_address,date,currency,subtotal,tax_amount,total,payment_method,line_items[description,quantity,amount]",
});

type Format = "text" | "markdown";
export type DocumentType = "docx" | "xlsx" | "pptx" | "pdf" | "image";

/** OCR (14 Nov 2026): the largest page image the vision model is given, and how many pages of a scan are read. */
const OCR_IMAGE_BYTES = 3 * 1024 * 1024;
const OCR_MAX_PAGES = 3;
/** Smaller embedded images are logos and stamps, not pages. */
const OCR_MIN_IMAGE_BYTES = 15 * 1024;

/** Reads the text of one page image, or throws. Passed in by the tools, so the readers stay testable without a model. */
export type Ocr = (image: Uint8Array, type: string) => Promise<string>;

/** The image type from the file's first bytes: PNG, JPEG or WebP (what the vision model takes). */
export function imageType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const indexOfBytes = (hay: Uint8Array, needle: Uint8Array, from: number): number => {
  outer: for (let i = from, end = hay.length - needle.length; i <= end; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};
const ascii = (s: string) => new TextEncoder().encode(s);

/**
 * The page images of a scanned PDF, in file order. A scanner writes each page as one JPEG and stores it in the PDF
 * unchanged (the DCTDecode filter), so the JPEG can be lifted out as it is: no page rendering, which a Worker cannot
 * do. Scans stored another way (fax-style CCITT or JBIG2) are not found here, and the caller says so.
 */
export function pdfPageImages(bytes: Uint8Array): Uint8Array[] {
  const marker = ascii("/DCTDecode"), streamWord = ascii("stream"), endWord = ascii("endstream");
  const images: Uint8Array[] = [];
  let at = 0;
  while (images.length < 40) {
    const hit = indexOfBytes(bytes, marker, at);
    if (hit < 0) break;
    const s = indexOfBytes(bytes, streamWord, hit);
    if (s < 0 || s - hit > 2000) { at = hit + marker.length; continue; }
    let start = s + streamWord.length;
    if (bytes[start] === 0x0d) start++;
    if (bytes[start] === 0x0a) start++;
    const end = indexOfBytes(bytes, endWord, start);
    if (end < 0) break;
    let stop = end;
    while (stop > start && (bytes[stop - 1] === 0x0a || bytes[stop - 1] === 0x0d)) stop--;
    const image = bytes.subarray(start, stop);
    if (image[0] === 0xff && image[1] === 0xd8 && image.length >= OCR_MIN_IMAGE_BYTES && image.length <= OCR_IMAGE_BYTES) images.push(image);
    at = end + endWord.length;
  }
  return images;
}

/** One page image to text with the vision model. Empty text is a refusal upstream: nothing readable is not an answer. */
export const visionOcr = (env: Env): Ocr => async (image, type) => {
  const out = await runAi<{ response?: string }>(env, MODELS.vision, {
    messages: [{ role: "user", content: [
      { type: "text", text: "Transcribe all text in this document image, top to bottom, exactly as written. Keep each line on its own line and keep the columns of a table on one line separated by tabs. Output only the transcribed text, with no comments. If the image holds no text, output nothing." },
      { type: "image_url", image_url: { url: `data:${type};base64,${Buffer.from(image).toString("base64")}` } },
    ] }],
    max_tokens: 2000,
    temperature: 0,
  });
  return (out?.response ?? "").trim();
};

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
      // mc:Fallback repeats, for old readers, what mc:Choice already holds (text boxes, shapes): reading both doubled the text.
      if (name === "w:del" || name === "w:instrText" || name === "w:delText" || name === "mc:Fallback") skip++;
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
      if (name === "w:del" || name === "w:instrText" || name === "w:delText" || name === "mc:Fallback") skip--;
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

/** Number formats Excel ships that show a date or a time (ECMA-376 18.8.30, plus the East Asian ones). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
/** A custom format code is a date or time when, outside quoted text and [brackets], it holds a d, m, y, h or s. */
export const isDateFormat = (code: string) => /[dmyhs]/i.test(code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "")) && !/^general$/i.test(code.trim());

/** For each cell style index, whether it shows a date or a time (xl/styles.xml: numFmts and cellXfs). */
export function dateStyles(xml: string | null): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  const styles: boolean[] = [];
  let inCellXfs = false;
  walk(xml, {
    open(name, a) {
      if (name === "numFmt" && a.numFmtId) custom.set(Number(a.numFmtId), a.formatCode ?? "");
      else if (name === "cellXfs") inCellXfs = true;
      else if (name === "xf" && inCellXfs && styles.length < 5000) {
        const id = Number(a.numFmtId ?? 0);
        styles.push(custom.has(id) ? isDateFormat(custom.get(id)!) : BUILTIN_DATE_FORMATS.has(id));
      }
    },
    close(name) { if (name === "cellXfs") inCellXfs = false; },
  });
  return styles;
}

/** Excel's day number as an ISO date, date-time or time. Day 60 of the 1900 system is the 29 February 1900 that never was. */
export function excelDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const days = Math.floor(serial);
  const seconds = Math.round((serial - days) * 86_400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(Math.floor(seconds / 3600) % 24)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  if (days === 0 && !date1904) return time;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 60 ? 31 : 30);
  const d = new Date(epoch + (days + (seconds >= 86_400 ? 1 : 0)) * 86_400_000);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return seconds === 0 || seconds >= 86_400 ? date : `${date}T${time}`;
}

function sheetRows(xml: string, strings: string[], dates: boolean[] = [], date1904 = false): { rows: string[][]; cut: boolean } {
  const rows: string[][] = [];
  let row: string[] | null = null;
  let ref = "";
  let type = "";
  let style = -1;
  let value: string[] | null = null;
  let reading = false;
  let cut = false;
  walk(xml, {
    open(name, a) {
      if (name === "row") { if (rows.length >= MAX_ROWS) { cut = true; row = null; } else row = []; }
      else if (name === "c") { ref = a.r ?? ""; type = a.t ?? ""; style = a.s === undefined ? -1 : Number(a.s); value = []; }
      else if (name === "v" || name === "t") reading = true;
    },
    text(t) { if (reading && value) value.push(t); },
    close(name) {
      if (name === "v" || name === "t") reading = false;
      else if (name === "c" && row && value) {
        const raw = value.join("");
        value = null;
        // A plain number in a cell whose style shows a date is a day number: give the date it shows.
        const asDate = (type === "" || type === "n") && raw !== "" && dates[style] ? excelDate(Number(raw), date1904) : null;
        // A number stored with more digits than a double holds (2.6303323046962774324020672609) is shown as the number it is.
        const number = (type === "" || type === "n") && /^-?\d*\.\d{16,}$/.test(raw) ? String(Number(raw)) : raw;
        const text = type === "s" ? strings[Number(raw)] ?? "" : type === "b" ? (raw === "1" ? "TRUE" : "FALSE") : asDate ?? number;
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
  let date1904 = false;
  walk(workbook, { open(name, a) {
    if (name === "sheet" && sheets.length < 200) sheets.push({ name: a.name ?? `Sheet ${sheets.length + 1}`, id: a["r:id"] ?? "" });
    else if (name === "workbookPr" && /^(1|true)$/i.test(a.date1904 ?? "")) date1904 = true;
  } });
  const targets = new Map<string, string>();
  const rels = await read("xl/_rels/workbook.xml.rels");
  if (rels) walk(rels, { open(name, a) { if (name === "Relationship" && a.Id && a.Target) targets.set(a.Id, a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target}`); } });
  const strings = sharedStrings(await read("xl/sharedStrings.xml"));
  const dates = dateStyles(await read("xl/styles.xml"));
  const parts: string[] = [];
  const summary: { name: string; rows: number; columns: number }[] = [];
  let cut = sheets.length > MAX_SHEETS;
  for (const [i, sheet] of sheets.slice(0, MAX_SHEETS).entries()) {
    const xml = await read(targets.get(sheet.id) ?? `xl/worksheets/sheet${i + 1}.xml`);
    if (!xml) continue; // a chart sheet or a missing part
    const { rows, cut: sheetCut } = sheetRows(xml, strings, dates, date1904);
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
  if (imageType(bytes)) return "image";
  if (!entries) return null;
  if (entries.has("word/document.xml")) return "docx";
  if (entries.has("xl/workbook.xml")) return "xlsx";
  if (entries.has("ppt/presentation.xml")) return "pptx";
  return null;
}

export async function readDocument(bytes: Uint8Array, format: Format, maxChars: number, ocr?: Ocr) {
  const entries = isZip(bytes) ? zipEntries(bytes) : null;
  const type = documentType(bytes, entries);
  if (!type) {
    const old = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    throw new HttpError(415, old
      ? "this is an old binary Office file (.doc, .xls or .ppt); save it as .docx, .xlsx or .pptx and send that (nothing was charged)"
      : "the file is not a Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF or image (PNG, JPEG, WebP) file (nothing was charged)");
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
    try {
      // PDF.js takes over the buffer it is given, so it reads a copy: a scan's page images are lifted from the original below.
      const pdf = await readPdf(ocr ? bytes.slice() : bytes, 1, 200, maxChars);
      text = pdf.pages.map((p) => p.text).join("\n\n");
      extra = { pages: pdf.totalPages };
      cut = pdf.truncated;
    } catch (e) {
      // A scan: no text layer. Its page images are read with the vision model, when they are stored as JPEGs.
      if (!ocr || !(e instanceof HttpError) || !/no text layer/.test(e.message)) throw e;
      const images = pdfPageImages(bytes);
      if (images.length === 0) throw new HttpError(422, "this scanned PDF has no text layer and its pages are not stored as JPEG images, so it cannot be read here (nothing was charged)");
      const read = await Promise.all(images.slice(0, OCR_MAX_PAGES).map((image) => ocr(image, "image/jpeg")));
      text = read.filter(Boolean).join("\n\n");
      extra = { ocr: true, pagesRead: Math.min(images.length, OCR_MAX_PAGES), note: `Scanned PDF: the text was read from its page images by an AI model (at most ${OCR_MAX_PAGES} pages a call). Check values that matter.` };
      cut = images.length > OCR_MAX_PAGES;
    }
  } else if (type === "image") {
    if (!ocr) throw new HttpError(415, "this tool does not read images (nothing was charged)");
    if (bytes.length > OCR_IMAGE_BYTES) throw new HttpError(422, "the image is larger than 3 MB; send a smaller scan or photo (nothing was charged)");
    text = await ocr(bytes, imageType(bytes)!);
    extra = { ocr: true, note: "Image: the text was read by an AI model. Check values that matter." };
  } else if (type === "docx") {
    text = docxText((await read("word/document.xml"))!, format);
    // Footnotes and endnotes live in their own parts; their text follows the body under a heading of its own.
    for (const [part, title] of [["word/footnotes.xml", "Footnotes"], ["word/endnotes.xml", "Endnotes"]] as const) {
      const xml = await read(part);
      const notes = xml ? docxText(xml, "text").trim() : "";
      if (notes) text += `\n\n${format === "markdown" ? `## ${title}` : title}\n\n${notes}`;
    }
  } else if (type === "xlsx") {
    const sheet = await xlsxText(bytes, entries!, format, read);
    text = sheet.text;
    extra = { sheets: sheet.sheets, note: "Cells hold the values the file stores: a formula's last calculated result. Dates and times are given in ISO form (2026-11-14, 2026-11-14T09:30:00, 09:30:00)." };
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
  return { type, format: type === "pdf" || type === "image" ? "text" as const : format, chars: text.length, truncated, ...extra, text };
}

export const DOCUMENT: Entry[] = [
  entry("/document/text", "Document to text: Word, Excel, PowerPoint, PDF",
    "Convert a document to text or Markdown: Word (.docx) with headings, lists and tables, Excel (.xlsx) sheet by sheet, PowerPoint (.pptx) slide by slide, a PDF's text, and scanned PDFs or images (PNG, JPEG, WebP) by OCR. Give a public file's URL, or send the file in a POST body (10 MB; images 3 MB). Old .doc/.xls/.ppt and password-protected files fail uncharged. Use to read attachments, scans and spreadsheets into an agent, RAG or a workflow.",
    ["docx-to-text", "word-to-markdown", "ocr", "xlsx-to-json", "document", "pptx", "office", "rag"], {
      url: { type: "string", description: "Absolute public http(s) URL of the file (or send the file in a POST body instead)", required: true, example: "https://calibre-ebook.com/downloads/demos/demo.docx" },
      format: { type: "string", description: "markdown (default: headings, lists and tables kept) or text", enum: ["markdown", "text"], example: "markdown" },
      maxChars: { type: "integer", description: "Maximum characters of text returned (1000-200000, default 50000)", example: 1000 },
    },
    {
      url: "https://calibre-ebook.com/downloads/demos/demo.docx",
      type: "docx", format: "markdown", chars: 1000, truncated: true,
      text: "# Demonstration of DOCX support in calibre\n\nThis document demonstrates the ability of the calibre DOCX Input plugin to convert the various typographic features in a Microsoft Word (2007 and newer) document.",
    },
    async (env, q) => {
      const format = pick(q, "format", ["markdown", "text"] as const, "markdown");
      const maxChars = num(q, "maxChars", { min: 1000, max: 200_000, fallback: 50_000, integer: true });
      const sent = q(FILE_REF_INPUT);
      if (isFileRef(sent)) {
        const bytes = heldFile(sent);
        if (!bytes) throw new HttpError(400, "send the file in a POST body (raw bytes, a multipart `file` part, or base64 in JSON); a file reference cannot be used in a GET");
        return { url: null, source: "upload", bytes: bytes.byteLength, ...(await readDocument(bytes, format, maxChars, visionOcr(env))) };
      }
      const file = await fetchFile(q("url"), /^/, DOCUMENT_MAX_BYTES, "a document", { cacheSeconds: 600, budgetMs: 20_000 });
      return { url: file.url, ...(await readDocument(file.bytes, format, maxChars, visionOcr(env))) };
      // $0.005, the PDF tool's price (the owner delegated prices on 14 Nov 2026: "you decide prices").
    }, "$0.005"),

  // Named fields out of a document (14 Nov 2026): the file is read as above and the fields are found by the chat model.
  // Why: "the invoice number, total and due date of this attachment" is the job automation builders bring a document
  // tool, and sellers price it per document, far above plain text. One Workers AI call per document; AI_DAILY_CAP
  // bounds the bill. The model reads at most EXTRACT_CHARS characters, and the answer says when the file held more.
  entry("/document/extract", "Extract data from a document: invoice, receipt, contract fields as JSON",
    "Extract named fields from a document as JSON: give a PDF, Word, Excel or PowerPoint file, a scan or a photo (PNG, JPEG, WebP) by URL or in a POST body (up to 10 MB; images 3 MB) and the field names you want, such as invoice_number, total, due_date. An AI model reads the file, scans by OCR, and returns one JSON object, with null where a value is not stated. Use to turn invoices, receipts, orders and contracts into rows.",
    ["invoice-parser", "document-extraction", "pdf-to-json", "invoice-ocr", "data-extraction", "document", "ai"], {
      url: { type: "string", description: "Absolute public http(s) URL of the file (or send the file in a POST body instead)", required: true, example: "https://calibre-ebook.com/downloads/demos/demo.docx" },
      fields: { type: "string", description: "Comma-separated field names to extract (1-30). For rows, give the row keys in brackets: line_items[description,quantity,amount]. Or one word, invoice or receipt, for the usual fields of that document with its line items", required: true, example: "title,ebook_formats,pens_needed,scissors_needed" },
    },
    {
      url: "https://calibre-ebook.com/downloads/demos/demo.docx",
      // A real answer, read on 14 Nov 2026 from a local run against Workers AI (twice, the same both times).
      type: "docx", data: { title: "Demonstration of DOCX support in calibre", ebook_formats: ["EPUB", "AZW3"], pens_needed: 3, scissors_needed: 1 },
      missing: [], model: EXTRACT_MODEL, charsRead: 8934, truncated: false,
    },
    async (env, q) => {
      const asked = need(q, "fields", 1000);
      const { fields, lists } = listFields(Object.hasOwn(FIELD_PRESETS, asked.trim().toLowerCase()) ? FIELD_PRESETS[asked.trim().toLowerCase()] : asked);
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
      const doc = await readDocument(bytes, "text", EXTRACT_CHARS, visionOcr(env));
      const found = await extractFields(env, doc.text, fields, EXTRACT_MODEL, Object.keys(lists).length ? 2600 : 1200, lists, true);
      return { url, ...(url ? {} : { source: "upload" }), type: doc.type, ...("ocr" in doc ? { ocr: true } : {}), ...found, charsRead: doc.chars, truncated: doc.truncated };
      // $0.03 a document: one model call, and a tenth to a half of what document-extraction sellers charge (14 Nov 2026).
    }, "$0.03"),
];
