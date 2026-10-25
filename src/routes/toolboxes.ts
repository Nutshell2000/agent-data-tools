// Developer toolboxes (1.60.0): many related transformations of one input in one paid call. The Bazaar search "developer
// tools" summed 195 payers over the top 20 on 24 Oct 2026, led by toolbox endpoints (hash & integrity 35, JSON toolbox 28,
// encoding toolbox 21). All local: Web Crypto, viem's keccak, and small MD5 and CRC-32 routines tested on standard vectors.
import { keccak256 } from "viem";
import { entry, flag, need, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { inferSchema } from "./calc";
import { jsonToYaml } from "./lookups";

const T = ["developer-tools", "utility", "dev"];
const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64Of = (b: Uint8Array) => btoa(String.fromCharCode(...b));

// ---------- MD5 (RFC 1321) ----------
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5(bytes: Uint8Array): string {
  const len = bytes.length, padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  padded.set(bytes); padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(len / 2 ** 29) >>> 0, true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d; d = c; c = b;
      const sum = (a + f + K[i] + view.getUint32(off + g * 4, true)) >>> 0;
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return hexOf(new Uint8Array(out.buffer));
}
// ---------- CRC-32 (IEEE) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes: Uint8Array): string {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export async function hashAll(bytes: Uint8Array) {
  const digest = async (alg: string) => new Uint8Array(await crypto.subtle.digest(alg, bytes));
  const [s1, s256, s384, s512] = await Promise.all(["SHA-1", "SHA-256", "SHA-384", "SHA-512"].map(digest));
  return {
    bytes: bytes.length, md5: md5(bytes), sha1: hexOf(s1), sha256: hexOf(s256), sha384: hexOf(s384), sha512: hexOf(s512),
    keccak256: keccak256(bytes), crc32: crc32(bytes),
    sri: { sha256: `sha256-${b64Of(s256)}`, sha384: `sha384-${b64Of(s384)}`, sha512: `sha512-${b64Of(s512)}` },
    base64: { sha256: b64Of(s256) },
  };
}

// ---------- encodings ----------
const HTML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function encodings(text: string) {
  const bytes = new TextEncoder().encode(text);
  const b64 = b64Of(bytes);
  let punycode: string | null = null;
  if (/^[^\s/:?#@]+(\.[^\s/:?#@]+)+$/.test(text) && /[^\x00-\x7f]/.test(text)) { try { punycode = new URL(`http://${text}`).hostname; } catch { /* not a host name */ } }
  const decoded: Record<string, string> = {};
  const tryDecode = (name: string, fn: () => string) => { try { const v = fn(); if (v && v !== text && !/�/.test(v)) decoded[name] = v; } catch { /* not this encoding */ } };
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(text) && text.length % 4 !== 1 && text.length >= 4) tryDecode("base64", () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")), (c) => c.charCodeAt(0))));
  if (/^(0x)?([0-9a-fA-F]{2})+$/.test(text)) tryDecode("hex", () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(text.replace(/^0x/, "").match(/../g)!.map((h) => parseInt(h, 16)))));
  if (/%[0-9a-fA-F]{2}/.test(text)) tryDecode("url", () => decodeURIComponent(text));
  if (/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|#39);/i.test(text)) tryDecode("html", () => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]));
  return {
    characters: [...text].length, utf8Bytes: bytes.length,
    base64: b64, base64url: b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), hex: hexOf(bytes),
    urlComponent: encodeURIComponent(text), url: encodeURI(text), html: text.replace(/[&<>"']/g, (c) => HTML[c]),
    rot13: text.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.toLowerCase().charCodeAt(0) - 97 + 13) % 26) + (c <= "Z" ? 65 : 97))),
    codePoints: [...text].slice(0, 100).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`),
    punycode, decoded,
  };
}

// ---------- JSON ----------
export function jsonStats(v: unknown) {
  let depth = 0, objects = 0, arrays = 0, keys = 0, strings = 0, numbers = 0, booleans = 0, nulls = 0;
  const walk = (x: unknown, d: number) => {
    depth = Math.max(depth, d);
    if (Array.isArray(x)) { arrays++; x.forEach((y) => walk(y, d + 1)); }
    else if (x && typeof x === "object") { objects++; for (const [, y] of Object.entries(x)) { keys++; walk(y, d + 1); } }
    else if (typeof x === "string") strings++; else if (typeof x === "number") numbers++; else if (typeof x === "boolean") booleans++; else if (x === null) nulls++;
  };
  walk(v, 0);
  return { depth, objects, arrays, keys, strings, numbers, booleans, nulls };
}
const sortKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;
function errorPosition(text: string, message: string) {
  const m = /position (\d+)/.exec(message);
  if (!m) return null;
  const pos = Number(m[1]), before = text.slice(0, pos);
  return { position: pos, line: before.split("\n").length, column: pos - before.lastIndexOf("\n") };
}

export const TOOLBOXES: Entry[] = [
  entry("/pack/hash-toolbox", "Hash toolbox: MD5, SHA-256, SHA-512, Keccak, CRC32 and SRI",
    "Every common hash of one input in a single call: MD5, SHA-1, SHA-256, SHA-384, SHA-512, Keccak-256 (Ethereum), CRC-32, base64 SHA-256, and Subresource Integrity strings (sha256-, sha384-, sha512-) for <script integrity>. Hashes UTF-8 text, or 0x/hex bytes with hex=true. Cheaper than hashing one algorithm at a time. Use for checksums, cache keys, file integrity and comparing digests across systems.",
    ["hash", ...T, "sha256", "md5", "checksum"], {
      text: { type: "string", description: "Text to hash (up to 100,000 characters), or hex bytes with hex=true", required: true, example: "hello world" },
      hex: { type: "string", description: "true to treat text as hex bytes (0x prefix optional)", example: "false" },
    },
    { bytes: 11, md5: "5eb63bbbe01eeed093cb22bb8f5acdc3", sha1: "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed", sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", sha384: "fdbd8e75a67f29f701a4e040385e2e23986303ea10239211af907fcbb83578b3e417cb71ce646efd0819dd8c088de1bd", sha512: "309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f", keccak256: "0x47173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad", crc32: "0d4a1185", sri: { sha256: "sha256-uU0nuZNNPgilLlLX2n2r+sSE7+N6U4DukIj3rOLvzek=", sha384: "sha384-/b2OdaZ/KfcBpOBAOF4uI5hjA+oQI5IRr5B/y7g1eLPkF8txzmRu/QgZ3YwIjeG9", sha512: "sha512-MJ7MSJwS1utMxA9QyQLytNDtd+5RGnx6m808qG1M2G+YndNbxf9JlnDaNCVbRbDP2DDoH2Bdz33FVC6TrpzXbw==" }, base64: { sha256: "uU0nuZNNPgilLlLX2n2r+sSE7+N6U4DukIj3rOLvzek=" } },
    async (_e, q) => {
      const text = need(q, "text", 100_000);
      let bytes: Uint8Array;
      if (flag(q, "hex")) {
        const h = text.trim().replace(/^0x/i, "");
        if (!/^([0-9a-fA-F]{2})*$/.test(h)) throw new HttpError(400, "with hex=true the text must be hex bytes");
        bytes = Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
      } else bytes = new TextEncoder().encode(text);
      return hashAll(bytes);
    }, "$0.01"),

  entry("/pack/encoding-toolbox", "Encoding toolbox: Base64, hex, URL, HTML and Unicode",
    "Every common encoding of one text in a single call: Base64 and Base64url, hex, URL component and full-URL encoding, HTML-escaped, ROT13, Unicode code points, UTF-8 byte count and Punycode for international domain names, plus automatic decoding when the input already looks like Base64, hex, URL or HTML encoding. Use to prepare data for headers, URLs and markup, or to work out what an encoded string says.",
    ["encoding", ...T, "base64", "url-encode", "hex"], { text: { type: "string", description: "The text (up to 20,000 characters)", required: true, example: "Café & <tags>" } },
    { characters: 13, utf8Bytes: 14, base64: "Q2Fmw6kgJiA8dGFncz4=", base64url: "Q2Fmw6kgJiA8dGFncz4", hex: "436166c3a92026203c746167733e", urlComponent: "Caf%C3%A9%20%26%20%3Ctags%3E", url: "Caf%C3%A9%20&%20%3Ctags%3E", html: "Café &amp; &lt;tags&gt;", rot13: "Pnsé & <gntf>", codePoints: ["U+0043", "U+0061"], punycode: null, decoded: {} },
    (_e, q) => encodings(need(q, "text", 20_000)), "$0.01"),

  entry("/pack/json-toolbox", "JSON toolbox: validate, format, minify, schema and YAML",
    "Everything about one JSON document in a single call: valid or not with the error's line and column, pretty-printed (optionally with sorted keys), minified with the bytes saved, an inferred JSON Schema, structure statistics (depth, objects, arrays, keys, value types) and the same data as YAML. Up to 200 KB. Cheaper than the separate JSON tools. Use to inspect API responses, clean model output or document a payload.",
    ["json-toolbox", ...T, "json", "json-schema"], {
      json: { type: "string", description: "The JSON text (up to 200 KB)", required: true, example: '{"name":"agent","tools":["weather","search"],"active":true,"limits":{"daily":100}}' },
      sortKeys: { type: "string", description: "true to sort object keys in the formatted output", example: "false" },
    },
    { valid: true, error: null, type: "object", bytes: 82, minifiedBytes: 82, formattedBytes: 121, saved: 0, formatted: "{\n  \"name\": \"agent\"\n}", minified: "{\"name\":\"agent\"}", schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, stats: { depth: 2, objects: 2, arrays: 1, keys: 5, strings: 3, numbers: 1, booleans: 1, nulls: 0 }, yaml: "name: agent\n" },
    async (_e, q) => {
      const text = need(q, "json", 200_000);
      let value: unknown;
      try { value = JSON.parse(text); }
      catch (e) { const msg = String((e as Error).message); return { valid: false, error: { message: msg.slice(0, 200), ...(errorPosition(text, msg) ?? {}) }, bytes: new TextEncoder().encode(text).length }; }
      const shown = flag(q, "sortKeys") ? sortKeys(value) : value;
      const formatted = JSON.stringify(shown, null, 2), minified = JSON.stringify(shown);
      const size = (s: string) => new TextEncoder().encode(s).length;
      return {
        valid: true, error: null, type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
        bytes: size(text), minifiedBytes: size(minified), formattedBytes: size(formatted), saved: size(text) - size(minified),
        formatted: formatted.length > 100_000 ? `${formatted.slice(0, 100_000)}… (truncated)` : formatted, minified,
        schema: inferSchema(value as Parameters<typeof inferSchema>[0]), stats: jsonStats(value), yaml: await jsonToYaml(minified),
      };
    }, "$0.01"),
];
