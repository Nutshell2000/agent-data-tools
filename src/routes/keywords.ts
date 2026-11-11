/**
 * Keyword research from search-engine autocomplete (5 Nov 2026). Demand: the SEO listings with repeat buyers on Base are
 * keyword tools (openverbs keyword overview 1,855 calls at $0.04, duoleads keyword ideas 654 calls at $0.04), and buyer
 * 0x72c5 paid $0.04 x 792 for SEO keyword data. We have no search-volume source, so we never claim volumes: the tool
 * returns the phrases real users type, from Google, Bing, YouTube, Amazon and DuckDuckGo suggestions, ranked by how many
 * engines suggest them. Google Trends answered 429 to automated requests on 5 Nov, so it is not used.
 * Licence: these suggestion endpoints have no resale terms of their own; the owner lifted the commercial-licence rule on
 * 5 Nov 2026 and accepts the risk (worst case an engine blocks Cloudflare's egress; the tool then answers with the
 * engines that still respond, and 502 uncharged if none do).
 */
import { entry, flag, need, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { addsForeignPlace, seedNamesPlace } from "../lib/place-names";

const UA = { "user-agent": "Mozilla/5.0 (compatible; AgentDataTools/1.0)" };
type Engine = "google" | "bing" | "youtube" | "amazon" | "duckduckgo";
const ENGINES: Engine[] = ["google", "bing", "youtube", "amazon", "duckduckgo"];

async function getText(url: string, ms = 5_000): Promise<unknown | null> {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
const opensearch = (v: unknown): string[] => (Array.isArray(v) && Array.isArray(v[1]) ? (v[1] as unknown[]).map(String) : []);

/**
 * Amazon's marketplace per country: completion host and marketplace id. Until 11 Nov 2026 every country got the US
 * store (cykel&country=se returned "cycle lamp"). Each answered from the PC that day with local suggestions; India's
 * host failed and is left out. A country without a marketplace skips Amazon and says so in enginesSkipped.
 */
export const AMAZON_MARKETS: Readonly<Record<string, readonly [string, string]>> = {
  us: ["com", "ATVPDKIKX0DER"], gb: ["co.uk", "A1F83G8C2ARO7P"], de: ["de", "A1PA6795UKMFR9"], fr: ["fr", "A13V1IB3VIYZZH"],
  it: ["it", "APJ6JRA9NG5V4"], es: ["es", "A1RKKUPIHCS9HS"], se: ["se", "A2NODRKZP88ZB9"], nl: ["nl", "A1805IZSGTT6HS"],
  pl: ["pl", "A1C3SOZRARQ6R3"], be: ["com.be", "AMEN7PMS3EDWL"], ie: ["ie", "A28R8C7NBKEWEA"], tr: ["com.tr", "A33AVAJ2PDY3EV"],
  ca: ["ca", "A2EUQ1WTGCTBG2"], mx: ["com.mx", "A1AM78C64UM0Y8"], br: ["com.br", "A2Q3Y263D00KWC"], jp: ["co.jp", "A1VC38T7YXB528"],
  au: ["com.au", "A39IBJ37TRP1C6"], sg: ["sg", "A19VAU5U5O7RUS"], ae: ["ae", "A2VIGQ35RCS4UG"], sa: ["sa", "A17E79C6D8DWNP"],
};
/** DuckDuckGo's region codes follow ISO except the United Kingdom ("uk-en"; "gb-en" is not a region there). */
const ddgRegion = (country: string) => (country === "gb" ? "uk" : country);

/** Suggestions one engine gives for one prefix; null when the engine did not answer. */
export async function suggest(engine: Engine, q: string, lang: string, country: string): Promise<string[] | null> {
  const e = encodeURIComponent(q);
  switch (engine) {
    case "google": { const v = await getText(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${lang}&gl=${country}&q=${e}`); return v === null ? null : opensearch(v); }
    case "youtube": { const v = await getText(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=${lang}&gl=${country}&q=${e}`); return v === null ? null : opensearch(v); }
    case "bing": { const v = await getText(`https://api.bing.com/osjson.aspx?market=${lang}-${country.toUpperCase()}&query=${e}`); return v === null ? null : opensearch(v); }
    case "duckduckgo": { const v = await getText(`https://duckduckgo.com/ac/?type=list&kl=${ddgRegion(country)}-${lang}&q=${e}`); return v === null ? null : opensearch(v); }
    case "amazon": {
      const market = Object.hasOwn(AMAZON_MARKETS, country) ? AMAZON_MARKETS[country] : null;
      if (!market) return null;
      const v = (await getText(`https://completion.amazon.${market[0]}/api/2017/suggestions?mid=${market[1]}&alias=aps&prefix=${e}`)) as { suggestions?: { value?: string }[] } | null;
      return v === null ? null : (v.suggestions ?? []).map((s) => String(s.value ?? "")).filter(Boolean);
    }
  }
}

const QUESTION = /^(how|what|why|when|where|which|who|can|is|are|does|do|should|will)\b/;
const COMMERCIAL = /\b(best|top|cheap|price|pricing|cost|buy|review|reviews|vs|alternative|alternatives|free|discount|deal|near me|for sale)\b/;

export async function keywordIdeas(seedIn: string, opts: { engines?: string; deep?: boolean; lang?: string; country?: string }) {
  const seed = seedIn.trim().toLowerCase().replace(/\s+/g, " ");
  if (seed.length < 2 || seed.length > 80) throw new HttpError(400, "seed must be 2-80 characters");
  const lang = (opts.lang ?? "en").toLowerCase();
  const country = (opts.country ?? "us").toLowerCase();
  if (!/^[a-z]{2}$/.test(lang) || !/^[a-z]{2}$/.test(country)) throw new HttpError(400, "lang and country are two-letter codes, e.g. en and us");
  const asked = opts.engines ? opts.engines.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : ENGINES;
  const bad = asked.filter((x) => !(ENGINES as string[]).includes(x));
  if (bad.length || !asked.length) throw new HttpError(400, `engines must be from: ${ENGINES.join(", ")}`);
  const enginesSkipped = asked.includes("amazon") && !Object.hasOwn(AMAZON_MARKETS, country) ? [{ engine: "amazon", reason: `no Amazon marketplace for country ${country}` }] : [];
  const engines = asked.filter((x) => !enginesSkipped.some((s) => s.engine === x));
  if (!engines.length) throw new HttpError(400, `no engine can answer for country ${country}: ${enginesSkipped.map((s) => s.reason).join("; ")}`);
  // Deep mode asks Google again with the seed plus each letter and question word: the long tail an SEO tool shows.
  const prefixes = [seed, ...(opts.deep ? [..."abcdefghijklmnopqrstuvwxyz"].map((c) => `${seed} ${c}`).concat(["how " + seed, "what " + seed, "best " + seed, seed + " vs"]) : [])];
  const jobs: { engine: Engine; prefix: string }[] = [];
  for (const engine of engines as Engine[]) for (const prefix of engine === "google" ? prefixes : [seed]) jobs.push({ engine, prefix });
  const results: { engine: Engine; prefix: string; list: string[] | null }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < jobs.length) { const j = jobs[next++]; results.push({ ...j, list: await suggest(j.engine, j.prefix, lang, country) }); }
  }));
  const answered = new Set(results.filter((r) => r.list !== null).map((r) => r.engine));
  if (!answered.size) throw new HttpError(502, "no search engine answered; try again");
  const sent = new Set(prefixes);
  const seen = new Map<string, { engines: Set<Engine>; hits: number }>();
  // Engines add the caller's own city or district to local-intent seeds whatever country is asked (in production that is
  // the Cloudflare data centre's city). Suggestions that only add a place outside the requested country are removed and
  // listed, unless the seed names a place itself.
  const filterPlaces = !seedNamesPlace(seed, lang);
  const removed = new Set<string>();
  for (const r of results) for (const k of r.list ?? []) {
    const key = k.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key || key.length > 120 || (key !== seed && sent.has(key))) continue; // a prefix we sent echoed back is not a keyword
    if (filterPlaces && addsForeignPlace(seed, key, country, lang)) { removed.add(key); continue; }
    const v = seen.get(key) ?? { engines: new Set<Engine>(), hits: 0 };
    v.engines.add(r.engine); v.hits++; seen.set(key, v);
  }
  const keywords = [...seen.entries()]
    .map(([keyword, v]) => ({ keyword, engines: [...v.engines], engineCount: v.engines.size, words: keyword.split(" ").length, question: QUESTION.test(keyword), commercial: COMMERCIAL.test(keyword) }))
    .sort((a, b) => b.engineCount - a.engineCount || (seen.get(b.keyword)!.hits - seen.get(a.keyword)!.hits) || a.keyword.length - b.keyword.length)
    .slice(0, 200);
  return {
    seed, lang, country, deep: Boolean(opts.deep), enginesAnswered: [...answered], enginesFailed: engines.filter((x) => !answered.has(x as Engine)), enginesSkipped,
    count: keywords.length,
    keywords,
    questions: keywords.filter((k) => k.question).map((k) => k.keyword).slice(0, 30),
    commercial: keywords.filter((k) => k.commercial).map((k) => k.keyword).slice(0, 30),
    removedAsLocation: [...removed].slice(0, 20),
    note: "Phrases real users type, from search-engine autocomplete. engineCount (how many engines suggest a phrase) is a popularity signal, not a search volume; no volumes or CPC are given. Suggestions that only added a city or country outside the requested one (engines add the requester's own location) are left out and listed in removedAsLocation.",
    checkedAt: new Date().toISOString(),
  };
}

export const KEYWORDS: Entry[] = [
  entry("/keywords/ideas", "Keyword ideas, keyword research",
    "Keyword ideas for SEO and ads: the search phrases real users type for a seed keyword, from Google, Bing, YouTube, Amazon and DuckDuckGo autocomplete, deduplicated and ranked by how many engines suggest each, with question and buying-intent phrases listed apart. deep=true adds the Google long tail (seed + a-z, how, what, best, vs), up to 200 keywords. Use to plan content, find long-tail and question keywords, or name a product. No search volumes.",
    ["keyword-ideas", "keyword-research", "seo-keywords", "long-tail-keywords", "autocomplete"],
    {
      seed: { type: "string", description: "Seed keyword or topic, 2-80 characters", required: true, example: "crm software" },
      deep: { type: "string", description: "true to add the Google long tail (seed + each letter, question words); about 30 more lookups", example: "false" },
      engines: { type: "string", description: "Optional comma list: google, bing, youtube, amazon, duckduckgo (default all)", example: "google,bing,amazon" },
      lang: { type: "string", description: "Language code (default en)", example: "en" },
      country: { type: "string", description: "Country code (default us); Amazon suggestions come from that country's store where one exists", example: "us" },
    },
    {
      seed: "crm software", lang: "en", country: "us", deep: false, enginesAnswered: ["google", "bing", "duckduckgo"], enginesFailed: [], count: 2,
      keywords: [
        { keyword: "crm software free", engines: ["google", "bing", "duckduckgo"], engineCount: 3, words: 3, question: false, commercial: true },
        { keyword: "crm software meaning", engines: ["google", "bing"], engineCount: 2, words: 3, question: false, commercial: false },
      ],
      questions: [], commercial: ["crm software free"], enginesSkipped: [], removedAsLocation: [],
      note: "Phrases real users type, from search-engine autocomplete. engineCount is a popularity signal, not a search volume.",
      checkedAt: "2026-11-05T19:30:00.000Z",
    },
    (_env, q) => keywordIdeas(need(q, "seed", 200), { engines: opt(q, "engines", 100), deep: flag(q, "deep"), lang: opt(q, "lang", 5), country: opt(q, "country", 5) })),
];
