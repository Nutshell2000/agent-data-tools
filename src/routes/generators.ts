// Barcodes, palettes and tables, computed locally (1.59.0). Bazaar search on 24 Oct 2026, summed 30-day payers over the
// top 20: barcode 36 (no listing of ours), color palette 37 (ours #10), markdown table 35 (#4), html table 33 (#6).
import { Parser } from "htmlparser2";
import { entry, flag, need, num, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { parseCsv } from "./utils";

const U = ["utility", "data"];

// ---------- barcodes ----------
/** Code 128 symbols 0-106 as module patterns (1 = bar), the standard ISO/IEC 15417 table; 106 is the stop pattern. */
export const CODE128 = "11011001100 11001101100 11001100110 10010011000 10010001100 10001001100 10011001000 10011000100 10001100100 11001001000 11001000100 11000100100 10110011100 10011011100 10011001110 10111001100 10011101100 10011100110 11001110010 11001011100 11001001110 11011100100 11001110100 11101101110 11101001100 11100101100 11100100110 11101100100 11100110100 11100110010 11011011000 11011000110 11000110110 10100011000 10001011000 10001000110 10110001000 10001101000 10001100010 11010001000 11000101000 11000100010 10110111000 10110001110 10001101110 10111011000 10111000110 10001110110 11101110110 11010001110 11000101110 11011101000 11011100010 11011101110 11101011000 11101000110 11100010110 11101101000 11101100010 11100011010 11101111010 11001000010 11110001010 10100110000 10100001100 10010110000 10010000110 10000101100 10000100110 10110010000 10110000100 10011010000 10011000010 10000110100 10000110010 11000010010 11001010000 11110111010 11000010100 10001111010 10100111100 10010111100 10010011110 10111100100 10011110100 10011110010 11110100100 11110010100 11110010010 11011011110 11011110110 11110110110 10101111000 10100011110 10001011110 10111101000 10111100010 11110101000 11110100010 10111011110 10111101110 11101011110 11110101110 11010000100 11010010000 11010011100 1100011101011".split(" ");
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;
/** Code 128 symbol values: set C for runs of 4+ digits (and all-digit even input), set B otherwise, with the mod-103 check. */
export function code128Values(text: string) {
  if (!/^[\x20-\x7e]+$/.test(text)) throw new HttpError(400, "Code 128 here takes printable ASCII characters (space to ~)");
  const values: number[] = [];
  let set: "B" | "C" | null = null;
  let i = 0;
  const digitsAt = (k: number) => (/^\d+/.exec(text.slice(k)) ?? [""])[0].length;
  while (i < text.length) {
    const run = digitsAt(i);
    const useC = run >= 4 || (run === text.length && run % 2 === 0 && run >= 2);
    if (useC) {
      if (set !== "C") { values.push(set === null ? START_C : CODE_C); set = "C"; }
      const pairs = Math.floor(run / 2);
      for (let k = 0; k < pairs; k++, i += 2) values.push(Number(text.slice(i, i + 2)));
      continue;
    }
    if (set !== "B") { values.push(set === null ? START_B : CODE_B); set = "B"; }
    values.push(text.charCodeAt(i) - 32);
    i++;
  }
  const check = values.reduce((sum, v, k) => sum + v * (k === 0 ? 1 : k), 0) % 103;
  return [...values, check, STOP];
}
const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
export const eanCheck = (twelve: string) => String((10 - ([...twelve].reduce((s, d, k) => s + Number(d) * (k % 2 ? 3 : 1), 0) % 10)) % 10);
export function ean13Modules(input: string) {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{12,13}$/.test(digits)) throw new HttpError(400, "EAN-13 needs 12 digits (the check digit is added) or 13 digits");
  const check = eanCheck(digits.slice(0, 12));
  if (digits.length === 13 && digits[12] !== check) throw new HttpError(400, `the check digit should be ${check}, not ${digits[12]}`);
  const code = digits.slice(0, 12) + check;
  const parity = EAN_PARITY[Number(code[0])];
  let bits = "101";
  for (let k = 1; k <= 6; k++) bits += (parity[k - 1] === "L" ? EAN_L : EAN_G)[Number(code[k])];
  bits += "01010";
  for (let k = 7; k <= 12; k++) bits += EAN_R[Number(code[k])];
  return { code, bits: bits + "101" };
}
/** Bars as SVG rectangles (runs of 1s merged), with a quiet zone and an optional human-readable line. */
export function barsSvg(bits: string, moduleWidth: number, height: number, label: string | null) {
  const quiet = 10 * moduleWidth, textH = label ? 18 : 0;
  const width = bits.length * moduleWidth + quiet * 2;
  let rects = "";
  for (let k = 0; k < bits.length;) {
    if (bits[k] !== "1") { k++; continue; }
    let end = k;
    while (bits[end] === "1") end++;
    rects += `<rect x="${quiet + k * moduleWidth}" y="0" width="${(end - k) * moduleWidth}" height="${height}"/>`;
    k = end;
  }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const text = label ? `<text x="${width / 2}" y="${height + 14}" font-family="monospace" font-size="14" text-anchor="middle">${esc(label)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + textH}" viewBox="0 0 ${width} ${height + textH}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>${text}</svg>`;
}
const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

// ---------- colour palettes ----------
const hexToHsl = (hex: string) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new HttpError(400, "color must be a hex colour such as #3366ff");
  const h6 = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((k) => parseInt(h6.slice(k, k + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l, hex: `#${h6.toLowerCase()}` };
};
export const hslToHex = (h: number, s: number, l: number) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
};
export function palette(hex: string) {
  const { h, s, l, hex: base } = hexToHsl(hex);
  const rot = (deg: number) => hslToHex((h + deg + 360) % 360, s, l);
  const clamp = (v: number) => Math.min(0.95, Math.max(0.05, v));
  return {
    base, hsl: { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) },
    complementary: [base, rot(180)], analogous: [rot(-30), base, rot(30)], triadic: [base, rot(120), rot(240)],
    splitComplementary: [base, rot(150), rot(210)], tetradic: [base, rot(90), rot(180), rot(270)],
    shades: [0.9, 0.75, 0.6, 0.45, 0.3, 0.15].map((v) => hslToHex(h, s, clamp(v))),
  };
}

// ---------- tables ----------
export function csvToMarkdown(rows: string[][], header: boolean) {
  if (!rows.length) throw new HttpError(400, "the CSV has no rows");
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (v = "") => v.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
  const head = header ? rows[0] : Array.from({ length: width }, (_, k) => `Column ${k + 1}`);
  const body = header ? rows.slice(1) : rows;
  const numeric = Array.from({ length: width }, (_, k) => body.length > 0 && body.every((r) => (r[k] ?? "").trim() === "" || /^-?[\d,]*\.?\d+%?$/.test((r[k] ?? "").trim())));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, k) => cell(r[k])).join(" | ")} |`;
  return [line(head), `| ${numeric.map((n) => (n ? "---:" : "---")).join(" | ")} |`, ...body.map(line)].join("\n");
}
/** Every <table> in the HTML as rows of cell texts (colspan repeated), with header cells kept apart. */
export function htmlTables(html: string, maxTables = 20) {
  const tables: { rows: string[][]; headerRows: number; caption: string | null }[] = [];
  const stack: { rows: string[][]; headerRows: number; caption: string | null }[] = [];
  let row: string[] | null = null, cellText: string | null = null, cellIsHead = false, rowAllHead = true, span = 1, inCaption = false, skip = 0;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === "script" || name === "style") { skip++; return; }
      if (name === "table") { stack.push({ rows: [], headerRows: 0, caption: null }); return; }
      const t = stack.at(-1);
      if (!t) return;
      if (name === "caption") { inCaption = true; t.caption = ""; }
      else if (name === "tr") { row = []; rowAllHead = true; }
      else if (name === "td" || name === "th") { cellText = ""; cellIsHead = name === "th"; span = Math.min(20, Math.max(1, Number(attrs.colspan) || 1)); }
      else if (name === "br" && cellText !== null) cellText += " ";
    },
    ontext(text) {
      if (skip) return;
      if (cellText !== null) cellText += text;
      else if (inCaption && stack.at(-1)) stack.at(-1)!.caption += text;
    },
    onclosetag(name) {
      if (name === "script" || name === "style") { skip = Math.max(0, skip - 1); return; }
      const t = stack.at(-1);
      if (!t) return;
      if (name === "caption") inCaption = false;
      else if ((name === "td" || name === "th") && cellText !== null && row) {
        const v = cellText.replace(/\s+/g, " ").trim();
        for (let k = 0; k < span; k++) row.push(v);
        if (!cellIsHead) rowAllHead = false;
        cellText = null;
      } else if (name === "tr" && row) {
        if (row.length) { t.rows.push(row); if (rowAllHead && t.rows.length === t.headerRows + 1) t.headerRows++; }
        row = null;
      } else if (name === "table") {
        const done = stack.pop()!;
        if (done.rows.length && tables.length < maxTables) tables.push({ ...done, caption: done.caption?.replace(/\s+/g, " ").trim() || null });
      }
    },
  }, { decodeEntities: true, lowerCaseTags: true });
  parser.write(html);
  parser.end();
  return tables;
}

export const GENERATORS: Entry[] = [
  entry("/barcode", "Barcode generator: Code 128 or EAN-13 as SVG",
    "Generate a barcode as an SVG image: Code 128 for any printable ASCII text (switching to the compact numeric set for runs of digits, with the mod-103 check symbol), or EAN-13 for 12 or 13 digits (the check digit is computed or verified). Set bar width and height and whether to print the text below. Returns the SVG and a data URL ready for an <img> tag. Use for shipping labels, product codes, tickets or inventory; for QR codes use qr.",
    ["barcode", "barcode-generator", "code128", "ean13", "svg", ...U], {
      text: { type: "string", description: "What to encode: ASCII text for Code 128, or 12-13 digits for EAN-13", required: true, example: "AGENT-12345" },
      type: { type: "string", description: "code128 (default) or ean13", example: "code128" },
      width: { type: "integer", description: "Module (narrowest bar) width in pixels, 1-6 (default 2)", example: 2 },
      height: { type: "integer", description: "Bar height in pixels, 20-300 (default 80)", example: 80 },
      label: { type: "string", description: "true (default) to print the text below the bars", example: "true" },
    },
    { type: "code128", text: "AGENT-12345", encoded: "AGENT-12345", modules: 156, svg: '<svg xmlns="http://www.w3.org/2000/svg" …</svg>', dataUrl: "data:image/svg+xml;base64,PHN2Zy…" },
    (_e, q) => {
      const type = pick(q, "type", ["code128", "ean13"] as const, "code128");
      const text = need(q, "text", 80);
      const w = num(q, "width", { min: 1, max: 6, fallback: 2, integer: true });
      const h = num(q, "height", { min: 20, max: 300, fallback: 80, integer: true });
      const showLabel = q("label")?.trim() ? flag(q, "label") : true;
      let bits: string, encoded: string;
      if (type === "ean13") { const e = ean13Modules(text); bits = e.bits; encoded = e.code; }
      else { bits = code128Values(text).map((v) => CODE128[v]).join(""); encoded = text; }
      const svg = barsSvg(bits, w, h, showLabel ? encoded : null);
      return { type, text, encoded, modules: bits.length, svg, dataUrl: `data:image/svg+xml;base64,${toBase64(svg)}` };
    }),

  entry("/color/palette", "Color palette generator: harmonies and shades from one color",
    "Build a colour palette from one hex colour: complementary, analogous, triadic, split-complementary and tetradic harmonies (hue rotations at the same saturation and lightness), plus six shades from light to dark, all as hex codes, with the base colour's HSL. Use for UI themes, charts, brand kits or slide decks; to check text readability on a colour use color_contrast.",
    ["color-palette", "palette", "color", "design", ...U], { color: { type: "string", description: "Base colour as hex, such as #3366ff or 36f", required: true, example: "#3366ff" } },
    { base: "#3366ff", hsl: { h: 225, s: 100, l: 60 }, complementary: ["#3366ff", "#ffcc33"], analogous: ["#33ccff", "#3366ff", "#6633ff"], triadic: ["#3366ff", "#ff3366", "#66ff33"], splitComplementary: ["#3366ff", "#ff6633", "#ccff33"], tetradic: ["#3366ff", "#ff33cc", "#ffcc33", "#33ff66"], shades: ["#ccd9ff", "#809fff", "#3366ff", "#0039e6", "#002699", "#00134d"] },
    (_e, q) => palette(need(q, "color", 20))),

  entry("/csv/to-markdown", "CSV to Markdown table: convert CSV into a GitHub table",
    "Convert CSV (comma, semicolon, tab or pipe, detected automatically; quoted fields supported) into a GitHub-flavoured Markdown table, with number columns right-aligned, pipes escaped and line breaks kept as <br>. Up to 100 KB. Use to show spreadsheet data in a README, chat reply, issue or report; for JSON use csv_to_json.",
    ["markdown-table", "csv-to-markdown", "csv", "markdown", ...U], {
      csv: { type: "string", description: "The CSV text (up to 100 KB)", required: true, example: "tool,price,calls\nweather,0.01,120\nsearch,0.01,45" },
      header: { type: "string", description: "true (default) if the first row holds the column names", example: "true" },
    },
    { markdown: "| tool | price | calls |\n| --- | ---: | ---: |\n| weather | 0.01 | 120 |\n| search | 0.01 | 45 |", rows: 2, columns: 3 },
    (_e, q) => {
      const rows = parseCsv(need(q, "csv", 100_000)).filter((r) => r.some((c) => c.trim() !== ""));
      if (rows.length > 5_000) throw new HttpError(400, "at most 5,000 rows");
      const header = q("header")?.trim() ? flag(q, "header") : true;
      return { markdown: csvToMarkdown(rows, header), rows: header ? Math.max(0, rows.length - 1) : rows.length, columns: Math.max(0, ...rows.map((r) => r.length)) };
    }),

  entry("/html/table-to-json", "HTML table to JSON: extract tables from HTML",
    "Extract every table from an HTML fragment into JSON: header cells become keys and each body row an object (or raw arrays when there is no header row), with captions, colspans repeated and entities decoded. Give the HTML itself (up to 500 KB). Use to turn web or email tables into data an agent can sort and compute on; to fetch a page first use extract.",
    ["html-table", "table-to-json", "html", "scraping", ...U], {
      html: { type: "string", description: "HTML containing one or more <table> elements (up to 500 KB)", required: true, example: "<table><tr><th>City</th><th>Pop.</th></tr><tr><td>Stockholm</td><td>984,748</td></tr><tr><td>Oslo</td><td>717,710</td></tr></table>" },
    },
    { count: 1, tables: [{ caption: null, headers: ["City", "Pop."], rows: [{ City: "Stockholm", "Pop.": "984,748" }, { City: "Oslo", "Pop.": "717,710" }] }] },
    (_e, q) => {
      const tables = htmlTables(need(q, "html", 500_000));
      if (!tables.length) throw new HttpError(422, "no <table> with rows was found in the HTML");
      return {
        count: tables.length,
        tables: tables.map((t) => {
          if (!t.headerRows) return { caption: t.caption, headers: null, rows: t.rows };
          const headers = t.rows[t.headerRows - 1].map((h, k) => h || `column${k + 1}`);
          const unique = headers.map((h, k) => (headers.indexOf(h) === k ? h : `${h}_${k + 1}`));
          return { caption: t.caption, headers: unique, rows: t.rows.slice(t.headerRows).map((r) => Object.fromEntries(unique.map((h, k) => [h, r[k] ?? ""]))) };
        }),
      };
    }),
];
