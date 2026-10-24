// ID and string toolboxes (1.62.0). Bazaar search on 24 Oct 2026, summed 30-day payers over the top 20: id generator 262
// (one listing has 232; ours was #11), ulid 24, nanoid 17, case converter 41 (ours #5), string utilities 21. Local only.
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const T = ["developer-tools", "utility", "dev"];
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fmtUuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export function uuidV4() { const b = rand(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; return fmtUuid(hex(b)); }
/** RFC 9562 UUID version 7: 48-bit Unix milliseconds, then random bits; sorts by creation time. */
export function uuidV7(ms = Date.now()) {
  const b = rand(16);
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  return fmtUuid(hex(b));
}
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** ULID: 10 characters of millisecond time and 16 of randomness in Crockford base32. */
export function ulid(ms = Date.now()) {
  let time = "", t = ms;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const r = rand(16);
  return time + [...r].map((x) => CROCKFORD[x & 31]).join("");
}
const URL_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
/** NanoID: 21 URL-safe characters from an unbiased 64-symbol alphabet. */
export const nanoid = (size = 21) => [...rand(size)].map((x) => URL_ALPHABET[x & 63]).join("");
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export function randomString(len: number, alphabet = BASE62) {
  let out = "";
  const limit = 256 - (256 % alphabet.length);
  while (out.length < len) for (const x of rand(len * 2)) { if (x < limit && out.length < len) out += alphabet[x % alphabet.length]; }
  return out;
}
/** Timestamp hidden in a ULID or a UUID v7 (v1 and v4 carry none we can read reliably). */
export function decodeId(id: string) {
  const s = id.trim();
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(s)) {
    const ms = [...s.slice(0, 10).toUpperCase()].reduce((acc, c) => acc * 32 + CROCKFORD.indexOf(c), 0);
    return { input: s, kind: "ulid", timestamp: new Date(ms).toISOString(), ms };
  }
  const u = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f])([0-9a-f]{3})-([89ab][0-9a-f]{3})-([0-9a-f]{12})$/i.exec(s);
  if (u) {
    const version = Number.parseInt(u[3], 16);
    if (version === 7) { const ms = Number.parseInt(u[1] + u[2], 16); return { input: s, kind: "uuid", version, timestamp: new Date(ms).toISOString(), ms }; }
    return { input: s, kind: "uuid", version, timestamp: null, ms: null };
  }
  return { input: s, kind: "unknown", timestamp: null, ms: null };
}

// ---------- strings ----------
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
export function allCases(s: string) {
  const w = words(s), lower = w.map((x) => x.toLowerCase()), cap = (x: string) => x[0].toUpperCase() + x.slice(1);
  return {
    camel: lower.map((x, i) => (i ? cap(x) : x)).join(""), pascal: lower.map(cap).join(""), snake: lower.join("_"), kebab: lower.join("-"),
    constant: lower.join("_").toUpperCase(), dot: lower.join("."), path: lower.join("/"), title: lower.map(cap).join(" "),
    sentence: lower.length ? cap(lower.join(" ")) : "", upper: s.toUpperCase(), lower: s.toLowerCase(),
  };
}
export const slugify = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);

export const TOOLBOXES2: Entry[] = [
  entry("/pack/id-toolbox", "ID generator: UUID v4, UUID v7, ULID, NanoID",
    "Generate unique IDs of every common kind in one call: UUID v4 (random), UUID v7 and ULID (time-ordered, sort by creation), NanoID (21 URL-safe characters) and random base62 and hex strings, up to 20 of each, from the platform's cryptographic random source; and decode the creation time hidden in a ULID or UUID v7. Use for database keys, request and trace IDs, file names or test data.",
    ["id-generator", "uuid", "ulid", "nanoid", ...T], {
      count: { type: "integer", description: "How many of each kind, 1-20 (default 3)", example: 3 },
      length: { type: "integer", description: "Length of the random strings, 8-128 (default 24)", example: 24 },
      decode: { type: "string", description: "Optional ULID or UUID to read the timestamp from", example: "01JB8ZQ3N4X6Q2W8E5R7T9Y1VZ" },
    },
    { uuidV4: ["0f8f3c4e-1a2b-4c3d-9e8f-1a2b3c4d5e6f"], uuidV7: ["01929d3c-4b5a-7c6d-8e9f-0a1b2c3d4e5f"], ulid: ["01JB8ZQ3N4X6Q2W8E5R7T9Y1VZ"], nanoid: ["V1StGXR8_Z5jdHi6B-myT"], base62: ["4fRz8Q2mXc1LpK9vT3aWbN7e"], hex: ["9f86d081884c7d659a2feaa0"], decoded: { input: "01JB8ZQ3N4X6Q2W8E5R7T9Y1VZ", kind: "ulid", timestamp: "2024-10-25T09:30:00.000Z", ms: 1729848600000 } },
    (_e, q) => {
      const count = num(q, "count", { min: 1, max: 20, fallback: 3, integer: true });
      const len = num(q, "length", { min: 8, max: 128, fallback: 24, integer: true });
      const many = <X>(f: () => X) => Array.from({ length: count }, f);
      const decode = opt(q, "decode", 64);
      return {
        uuidV4: many(uuidV4), uuidV7: many(() => uuidV7()), ulid: many(() => ulid()), nanoid: many(() => nanoid()),
        base62: many(() => randomString(len)), hex: many(() => randomString(len, "0123456789abcdef")),
        decoded: decode ? decodeId(decode) : null,
      };
    }, "$0.02"),

  entry("/pack/string-toolbox", "String utilities: every case, slug, counts and more",
    "Transform one string every common way at once: camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, dot.case, path/case, Title Case, Sentence case, upper and lower; a URL slug (accents removed); reversed; trimmed and whitespace-collapsed; and counts of characters, letters, digits, words and lines. Splits identifiers like userIDValue or XMLHttpRequest correctly. Use when naming fields, files and routes or cleaning user input.",
    ["string-utilities", "case-converter", "slugify", "text", ...T], { text: { type: "string", description: "The string (up to 10,000 characters)", required: true, example: "Hello World, user profile ID 42" } },
    { cases: { camel: "helloWorldUserProfileId42", pascal: "HelloWorldUserProfileId42", snake: "hello_world_user_profile_id_42", kebab: "hello-world-user-profile-id-42", constant: "HELLO_WORLD_USER_PROFILE_ID_42", dot: "hello.world.user.profile.id.42", path: "hello/world/user/profile/id/42", title: "Hello World User Profile Id 42", sentence: "Hello world user profile id 42", upper: "HELLO WORLD, USER PROFILE ID 42", lower: "hello world, user profile id 42" }, slug: "hello-world-user-profile-id-42", reversed: "24 DI eliforp resu ,dlroW olleH", collapsed: "Hello World, user profile ID 42", counts: { characters: 31, letters: 23, digits: 2, words: 6, lines: 1 } },
    (_e, q) => {
      const text = need(q, "text", 10_000);
      if (!text.trim()) throw new HttpError(400, "text is empty");
      return {
        cases: allCases(text), slug: slugify(text), reversed: [...text].reverse().join(""), collapsed: text.replace(/\s+/g, " ").trim(),
        counts: { characters: [...text].length, letters: (text.match(/\p{L}/gu) ?? []).length, digits: (text.match(/\p{N}/gu) ?? []).length, words: (text.match(/\S+/g) ?? []).length, lines: text.split(/\r?\n/).length },
      };
    }, "$0.02"),
];
