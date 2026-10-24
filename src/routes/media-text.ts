// Image metadata, language detection, favicons and user agents (1.65.0). Bazaar search on 24 Oct 2026, summed 30-day payers
// over the top 20, nothing of ours: exif 55, image metadata 31, detect language 57, language detection 47, favicon 38,
// user agent parser 28. Local parsing (EXIF, user agents), franc-min 6.2.0 (MIT) for languages, and the public-URL
// fetcher for images and pages.
import { franc, francAll } from "franc-min";
import { entry, need, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { fetchFile, fetchPublic, parseTarget } from "../lib/fetch";

const U = ["utility", "data"];

// ---------- image metadata ----------
type Exif = Record<string, string | number | null>;
const TAGS: Record<number, string> = { 0x010f: "make", 0x0110: "model", 0x0112: "orientation", 0x0131: "software", 0x0132: "modified", 0x013b: "artist", 0x8298: "copyright",
  0x9003: "takenAt", 0x829a: "exposureTime", 0x829d: "fNumber", 0x8827: "iso", 0x920a: "focalLengthMm", 0xa434: "lens", 0xa002: "exifWidth", 0xa003: "exifHeight" };
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
/** Reads IFD0, the Exif IFD and the GPS IFD of a TIFF block (the payload of a JPEG APP1 "Exif" segment). */
export function parseTiff(view: DataView, start: number): { tags: Exif; gps: { lat: number; lon: number; altitudeM: number | null } | null } {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (o: number) => view.getUint16(start + o, little), u32 = (o: number) => view.getUint32(start + o, little), s32 = (o: number) => view.getInt32(start + o, little);
  const tags: Exif = {};
  const gpsRaw: Record<number, unknown> = {};
  const readValue = (entry: number) => {
    const type = u16(entry + 2), count = u32(entry + 4), size = (TYPE_SIZE[type] ?? 1) * count;
    const at = size <= 4 ? entry + 8 : u32(entry + 8);
    if (start + at + size > view.byteLength) return null;
    if (type === 2) { let s = ""; for (let i = 0; i < count - 1 && i < 256; i++) s += String.fromCharCode(view.getUint8(start + at + i)); return s.trim(); }
    if (type === 3) return count === 1 ? u16(at) : Array.from({ length: Math.min(count, 8) }, (_, i) => u16(at + i * 2));
    if (type === 4) return count === 1 ? u32(at) : Array.from({ length: Math.min(count, 8) }, (_, i) => u32(at + i * 4));
    if (type === 5 || type === 10) {
      const one = (i: number) => { const n = type === 5 ? u32(at + i * 8) : s32(at + i * 8), d = type === 5 ? u32(at + i * 8 + 4) : s32(at + i * 8 + 4); return d ? n / d : 0; };
      return count === 1 ? one(0) : Array.from({ length: Math.min(count, 8) }, (_, i) => one(i));
    }
    if (type === 1 || type === 7) return count === 1 ? view.getUint8(start + at) : null;
    return null;
  };
  const walk = (ifd: number, kind: "main" | "gps", depth = 0) => {
    if (depth > 2 || ifd <= 0 || start + ifd + 2 > view.byteLength) return;
    const n = u16(ifd);
    for (let i = 0; i < n && i < 200; i++) {
      const entry = ifd + 2 + i * 12;
      if (start + entry + 12 > view.byteLength) break;
      const tag = u16(entry);
      if (kind === "gps") { gpsRaw[tag] = readValue(entry); continue; }
      if (tag === 0x8769) walk(u32(entry + 8), "main", depth + 1);
      else if (tag === 0x8825) walk(u32(entry + 8), "gps", depth + 1);
      else if (TAGS[tag]) { const v = readValue(entry); if (v !== null && !Array.isArray(v)) tags[TAGS[tag]] = typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v; }
    }
  };
  walk(u32(4), "main");
  const dms = (v: unknown) => (Array.isArray(v) && v.length >= 3 ? v[0] + v[1] / 60 + v[2] / 3600 : null);
  const lat = dms(gpsRaw[2]), lon = dms(gpsRaw[4]);
  const gps = lat !== null && lon !== null ? {
    lat: Math.round((gpsRaw[1] === "S" ? -lat : lat) * 1e6) / 1e6, lon: Math.round((gpsRaw[3] === "W" ? -lon : lon) * 1e6) / 1e6,
    altitudeM: typeof gpsRaw[6] === "number" ? Math.round((gpsRaw[5] === 1 ? -gpsRaw[6] : gpsRaw[6]) * 10) / 10 : null,
  } : null;
  return { tags, gps };
}
export function imageInfo(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let width: number | null = null, height: number | null = null, exif: ReturnType<typeof parseTiff> | null = null;
    for (let o = 2; o + 4 < bytes.length;) {
      if (bytes[o] !== 0xff) { o++; continue; }
      const marker = bytes[o + 1], len = v.getUint16(o + 2);
      if (marker === 0xe1 && ascii(o + 4, 4) === "Exif" && !exif) { try { exif = parseTiff(v, o + 10); } catch { exif = null; } }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { height = v.getUint16(o + 5); width = v.getUint16(o + 7); break; }
      if (marker === 0xda) break;
      o += 2 + len;
    }
    return { format: "jpeg", width, height, exif: exif?.tags ?? {}, gps: exif?.gps ?? null };
  }
  if (ascii(1, 3) === "PNG") return { format: "png", width: v.getUint32(16), height: v.getUint32(20), exif: {}, gps: null };
  if (ascii(0, 3) === "GIF") return { format: "gif", width: v.getUint16(6, true), height: v.getUint16(8, true), exif: {}, gps: null };
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") return { format: "webp", width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)), exif: {}, gps: null };
    if (chunk === "VP8L") { const b = v.getUint32(21, true); return { format: "webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, exif: {}, gps: null }; }
    if (chunk === "VP8 ") return { format: "webp", width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff, exif: {}, gps: null };
    return { format: "webp", width: null, height: null, exif: {}, gps: null };
  }
  throw new HttpError(422, "not a JPEG, PNG, GIF or WebP image");
}

// ---------- languages ----------
const LANGS = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "language" }) : null;
const ISO1: Record<string, string> = { eng: "en", spa: "es", fra: "fr", deu: "de", ita: "it", por: "pt", nld: "nl", swe: "sv", nob: "nb", dan: "da", fin: "fi", pol: "pl", rus: "ru", ukr: "uk", tur: "tr", arb: "ar", cmn: "zh", jpn: "ja", kor: "ko", hin: "hi", ben: "bn", ind: "id", vie: "vi", tha: "th", ell: "el", ces: "cs", ron: "ro", hun: "hu", heb: "he", pes: "fa", urd: "ur", zsm: "ms", tgl: "tl", swh: "sw" };
const langName = (code: string) => { const two = ISO1[code]; try { return LANGS?.of(two ?? code) ?? null; } catch { return null; } };

// ---------- user agents ----------
const BOTS: [RegExp, string][] = [[/googlebot/i, "Googlebot"], [/bingbot/i, "Bingbot"], [/gptbot/i, "GPTBot (OpenAI)"], [/chatgpt-user/i, "ChatGPT-User"], [/oai-searchbot/i, "OAI-SearchBot"], [/claudebot|claude-web|anthropic/i, "ClaudeBot (Anthropic)"], [/perplexitybot/i, "PerplexityBot"], [/applebot/i, "Applebot"], [/yandex/i, "YandexBot"], [/baiduspider/i, "Baiduspider"], [/duckduckbot/i, "DuckDuckBot"], [/facebookexternalhit|meta-externalagent/i, "Meta crawler"], [/twitterbot/i, "Twitterbot"], [/slackbot/i, "Slackbot"], [/discordbot/i, "Discordbot"], [/ahrefsbot/i, "AhrefsBot"], [/semrushbot/i, "SemrushBot"], [/bytespider/i, "Bytespider"], [/ccbot/i, "CCBot"], [/curl\//i, "curl"], [/wget\//i, "Wget"], [/python-requests|python-urllib|aiohttp|httpx/i, "Python HTTP client"], [/node-fetch|undici|axios/i, "Node HTTP client"], [/go-http-client/i, "Go HTTP client"], [/postmanruntime/i, "Postman"], [/headlesschrome/i, "Headless Chrome"], [/bot|crawler|spider|crawl|slurp/i, "Other bot"]];
const WINDOWS: Record<string, string> = { "10.0": "10 or 11", "6.3": "8.1", "6.2": "8", "6.1": "7", "6.0": "Vista", "5.1": "XP" };
export function parseUserAgent(ua: string) {
  const m = (re: RegExp) => re.exec(ua)?.[1] ?? null;
  const bot = BOTS.find(([re]) => re.test(ua))?.[1] ?? null;
  let browser: string | null = null, version: string | null = null;
  const order: [string, RegExp][] = [["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/], ["Opera", /OPR\/([\d.]+)/], ["Samsung Internet", /SamsungBrowser\/([\d.]+)/], ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/], ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/], ["Safari", /Version\/([\d.]+).*Safari/]];
  for (const [name, re] of order) { const v = m(re); if (v) { browser = name; version = v; break; } }
  let os: string | null = null, osVersion: string | null = null;
  if (/Windows NT ([\d.]+)/.test(ua)) { os = "Windows"; osVersion = WINDOWS[m(/Windows NT ([\d.]+)/)!] ?? m(/Windows NT ([\d.]+)/); }
  else if (/iPhone|iPad|iPod/.test(ua)) { os = "iOS"; osVersion = m(/OS (\d+[_\d]*)/)?.replace(/_/g, ".") ?? null; }
  else if (/Android/.test(ua)) { os = "Android"; osVersion = m(/Android ([\d.]+)/); }
  else if (/Mac OS X/.test(ua)) { os = "macOS"; osVersion = m(/Mac OS X (\d+[_.\d]*)/)?.replace(/_/g, ".") ?? null; }
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  const device = bot ? "bot" : /iPad|Tablet|SM-T|Nexus (7|9|10)/i.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "tablet" : /Mobi|iPhone|iPod|Android.*Mobile/i.test(ua) ? "mobile" : os ? "desktop" : null;
  return { userAgent: ua, browser, browserVersion: version, majorVersion: version ? Number(version.split(".")[0]) : null, os, osVersion, device, isBot: !!bot, bot };
}

// ---------- favicons ----------
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((x) => x !== undefined) ?? null;

export const MEDIA_TEXT: Entry[] = [
  entry("/image/metadata", "Image metadata, EXIF: camera, date, GPS and size",
    "Read an image's metadata from its URL: format (JPEG, PNG, GIF or WebP), width and height, and for JPEG photos the EXIF data: camera make and model, lens, date taken, exposure, aperture, ISO, focal length, orientation, software and the GPS position (latitude, longitude, altitude) when it was recorded. Up to 15 MB. Use to check where and when a photo was taken, verify an upload, or strip-check images before publishing.",
    ["exif", "image-metadata", "gps", "photo", "image", ...U], { url: { type: "string", description: "Public URL of the image", required: true, example: "https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/gps/DSCN0010.jpg" } },
    { url: "https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/gps/DSCN0010.jpg", format: "jpeg", width: 640, height: 480, bytes: 161713, exif: { make: "NIKON", model: "COOLPIX P6000", takenAt: "2008:10:22 16:28:39", orientation: 1, software: "Nikon Transfer 1.1 W" }, gps: { lat: 43.467448, lon: 11.885127, altitudeM: null } },
    async (_e, q) => {
      const file = await fetchFile(need(q, "url", 2_000), /^image\/|octet-stream|^$/i, 15 * 1024 * 1024, "image", { cacheSeconds: 600 });
      return { url: file.url, ...imageInfo(file.bytes), bytes: file.bytes.length };
    }),

  entry("/text/language", "Language detection: detect the language of a text",
    "Detect which language a text is written in: the most likely language with its ISO 639-3 and 639-1 codes and English name, plus the next candidates with relative scores, using trigram statistics for 82 major languages (franc-min). Works best above about 20 characters; very short or mixed text returns und (undetermined). Local, no outside service. Use to route messages, pick a translation target or filter content by language.",
    ["language-detection", "detect-language", "language", "text", "nlp", ...U], { text: { type: "string", description: "The text (up to 10,000 characters)", required: true, example: "Det här är en mening skriven på svenska om väder och resor." } },
    { language: { iso6393: "swe", iso6391: "sv", name: "Swedish" }, confident: true, candidates: [{ iso6393: "swe", name: "Swedish", score: 1 }, { iso6393: "nld", name: "Dutch", score: 0.726 }], characters: 59 },
    (_e, q) => {
      const text = need(q, "text", 10_000);
      const code = franc(text, { minLength: 10 });
      const all = francAll(text, { minLength: 10 }).filter(([c]) => c !== "und").slice(0, 5);
      const confident = code !== "und" && (all.length < 2 || all[0][1] - all[1][1] > 0.02);
      return {
        language: { iso6393: code, iso6391: ISO1[code] ?? null, name: code === "und" ? null : langName(code) }, confident,
        candidates: all.map(([c, score]) => ({ iso6393: c, name: langName(c), score: Math.round(score * 1000) / 1000 })), characters: [...text].length,
      };
    }),

  entry("/useragent/parse", "User agent parser: browser, OS, device and bots",
    "Parse a User-Agent string into browser and version, operating system and version, device type (desktop, mobile, tablet or bot) and, for crawlers, which bot it is: Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot, social previewers, SEO crawlers and HTTP libraries such as curl or python-requests. Local rules, no outside service. Use to read access logs, segment traffic or spot AI crawlers.",
    ["user-agent-parser", "user-agent", "bot-detection", "web", "analytics", ...U], { ua: { type: "string", description: "The User-Agent string", required: true, example: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" } },
    { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/130.0.0.0 Safari/537.36", browser: "Chrome", browserVersion: "130.0.0.0", majorVersion: 130, os: "Windows", osVersion: "10 or 11", device: "desktop", isBot: false, bot: null },
    (_e, q) => parseUserAgent(need(q, "ua", 1_000))),

  entry("/url/favicon", "Favicon finder: a site's icons and their sizes",
    "Find a website's icons: every <link rel=icon>, shortcut icon, apple-touch-icon and mask-icon on the page with its size and type, the web app manifest link, and whether /favicon.ico exists, all as absolute URLs, with the best icon picked (SVG, then the largest size; mask icons never). Use to show a site's logo next to a link, build bookmarks or enrich a company record.",
    ["favicon", "icon", "logo", "web", ...U], { url: { type: "string", description: "Page or site URL", required: true, example: "https://github.com/" } },
    { url: "https://github.com/", best: "https://github.githubassets.com/favicons/favicon.svg", icons: [{ href: "https://github.githubassets.com/favicons/favicon.svg", rel: "icon", sizes: null, type: "image/svg+xml" }], manifest: "https://github.com/manifest.json", faviconIco: true },
    async (_e, q) => {
      const page = parseTarget(need(q, "url", 2_000));
      const res = await fetchPublic(page, "text/html,*/*;q=0.5", [], { cacheSeconds: 600 });
      const html = (await new Response(res.body).text()).slice(0, 500_000);
      const base = new URL(res.headers.get("x-final-url") ?? res.url ?? page.href);
      const abs = (h: string) => { try { return new URL(h, base).href; } catch { return null; } };
      const links = html.match(/<link\b[^>]*>/gi) ?? [];
      const icons = links.map((l) => ({ rel: (attr(l, "rel") ?? "").toLowerCase(), href: attr(l, "href"), sizes: attr(l, "sizes"), type: attr(l, "type") }))
        .filter((l) => l.href && /(^|\s)(icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)(\s|$)/.test(l.rel))
        .map((l) => ({ href: abs(l.href!), rel: l.rel, sizes: l.sizes, type: l.type })).filter((l) => l.href).slice(0, 30);
      const manifestTag = links.find((l) => (attr(l, "rel") ?? "").toLowerCase() === "manifest");
      let faviconIco = false;
      try { const r = await fetchPublic(new URL("/favicon.ico", base), "image/*", [404, 403, 410]); faviconIco = r.status < 400; await r.body?.cancel(); } catch { faviconIco = false; }
      const size = (s: string | null) => Math.max(0, ...(s ?? "").split(/\s+/).map((x) => Number(x.split("x")[0]) || 0), 0);
      const sorted = icons.filter((i) => i.rel !== "mask-icon").sort((a, b) => (b.type === "image/svg+xml" ? 1 : 0) - (a.type === "image/svg+xml" ? 1 : 0) || size(b.sizes) - size(a.sizes));
      return { url: base.href, best: sorted[0]?.href ?? (faviconIco ? new URL("/favicon.ico", base).href : null), icons, manifest: manifestTag ? abs(attr(manifestTag, "href") ?? "") : null, faviconIco };
    }),
];
