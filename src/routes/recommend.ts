// "Which API should I call?" (1.77.0, 25 Oct 2026). On the Bazaar the API recommender agents-trust.com/recommend sold 8,885
// calls to 29 payers in 30 days (about 300 calls per payer, still called that day), and the searches "api recommendation",
// "recommend api", "find api" and "which api" had nothing of ours. This one recommends from our own catalog: each answer is
// the exact call for the best-matching tools, so a bot that asks comes back to buy the call. Lexical scoring over each tool's
// name, tags and copy, then BAAI bge-reranker-base orders the top candidates (lexical order when the model is unavailable).
import { entry, getJson, need, num, opt, type Entry } from "../family";
import { listing, type BazaarItem } from "./x402-find";
import { runAi } from "../lib/ai";
import { HttpError, type Env } from "../lib/env";
import { RERANK_MODEL } from "./retrieval";

const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const STOP = new Set("a an and are as at be by can do does for from get give how i in is it me my of on or please show tell that the this to use want what when where which who why with you your api apis call tool tools find need no thing things something anything nothing such catalog stuff".split(" "));

// Words agents use for a task, mapped onto the words our tool names use.
// 19 Nov 2026: `iban`, `llm` and `block` used to be forced onto invoice/chat/sanctions here, which sent "validate iban"
// to the $0.05 /invoice/check, "llm pricing" to /ai/chat and "block explorer" to /sanctions/check. Those words now keep
// their own token and are routed by the JOBS phrases below. `vat` keeps its invoice hint because "vat number" is covered
// by a JOBS phrase; "validate vat" is too.
const SYNONYMS: Readonly<Record<string, string>> = { remember: "memory", recall: "memory", save: "memory", store: "memory", forget: "memory", sanctioned: "sanctions", ofac: "sanctions", scrape: "extract", crawl: "extract", markdown: "extract", gpt: "chat", completion: "chat", temperature: "weather", currency: "fx", exchange: "fx", eur: "fx", usd: "fx", whois: "domain", rug: "honeypot", ether: "eth", ethereum: "eth", bitcoin: "btc", // expanded synonym set for better tool discovery
  price: "token", quote: "token", value: "token", balance: "wallet", portfolio: "wallet", holdings: "wallet",
  fee: "gas", fees: "gas", gwei: "gas", gasprice: "gas",
  vat: "invoice", tax: "invoice", billing: "invoice",
  company: "domain", firm: "domain", business: "domain", organization: "domain", organisation: "domain",
  email: "mail", mail: "email", mailbox: "email",
  phone: "contact", contact: "phone", tel: "phone", telephone: "phone",
  url: "link", link: "url", website: "url", webpage: "url",
  pdf: "document", document: "pdf", doc: "pdf", file: "pdf",
  audio: "speech", voice: "speech", sound: "speech", tts: "speech", stt: "transcribe",
  translate: "translation", language: "translation", localize: "translation", i18n: "translation",
  crypto: "token", coin: "token", asset: "token", ticker: "token",
  stock: "equity", equity: "stock", share: "stock", shares: "stock",
  search: "find", find: "search", lookup: "search", query: "search",
  audit: "check", verify: "check", validate: "check", test: "check",
  blocked: "sanctions", screen: "sanctions", screening: "sanctions",
  phishing: "risk", malicious: "risk", scam: "risk", fraud: "risk", suspicious: "risk",
  hash: "crypto", encrypt: "crypto", decrypt: "crypto", sign: "crypto", signature: "crypto",
  json: "data", csv: "data", xml: "data", yaml: "data", parse: "data",
  timestamp: "time", datetime: "time", schedule: "time", cron: "time",
  number: "math", calculate: "math", compute: "math", calc: "math",
  ip: "network", network: "ip", dns: "domain",
  nft: "token", collection: "nft", metadata: "nft",
  swap: "dex", trade: "dex", liquidity: "dex", pool: "dex",
  defi: "token", yield: "defi", tvl: "defi", apr: "defi", apy: "defi",
  news: "search", headline: "news", article: "news",
  seo: "web", web: "seo", site: "web", page: "web",
  security: "risk", safe: "risk", unsafe: "risk", vulnerability: "risk", cve: "risk",
  weather: "forecast", forecast: "weather",
  location: "geo", geo: "location", map: "geo", address: "geo",
  text: "document", read: "extract", fetch: "extract", get: "extract",
};
/** Light stemming: "sanctioned" and "sanctions" both become "sanction"; prefix matching does the rest. */
const stem = (w: string) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, "") : w.length > 3 ? w.replace(/s$/, "") : w);
export const tokens = (s: string) => {
  const words = s.toLowerCase().replace(/[^a-z0-9$.\s-]/g, " ").split(/[\s-]+/).map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w.length > 1 && !STOP.has(w));
  const out = new Set(words.flatMap((w) => (Object.hasOwn(SYNONYMS, w) ? [stem(w), SYNONYMS[w]] : [stem(w)])));
  // "price of ETH" asks for a token price, not a gas price, unless gas or fees are named. A stock/share/equity
  // price is NOT crypto: "share price of Apple" otherwise routed to the token price tool first.
  if (out.has("price") && !["gas", "fee", "fees", "stock", "share", "shares", "equity"].some((w) => out.has(w))) { out.add("token"); out.add("crypto"); }
  return [...out];
};

/** `also`: the names and tags of the entry paths that run this tool, so the phrases those doors were named for find it. */
type Doc = { path: string; name: string; tags: string[]; summary: string; description: string; price: string; also?: string };

/** The request as written: lower case, punctuation as spaces. Word order is kept ("text to speech" is not "speech to text"). */
export const asWritten = (s: string) => s.toLowerCase().replace(/[^a-z0-9$.]+/g, " ").trim();

/**
 * Jobs as buyers name them, each with the tool that does it (1.111.0, 11 Nov 2026). The names are what our paying
 * wallets bought from other sellers that week (base-bots/buyer-next.mjs); word and phrase scoring sent several to the
 * wrong tool: "audit bundle" to the package audit, "hunter email verifier" to the x402 finder, "token preflight" to the
 * token lookup, "tts elevenlabs" below speech to text. A request that holds one of these phrases as whole words gets
 * that tool first; the longest phrase wins. Keep each phrase to a job the tool really does, and add one when buyer-next
 * shows a job landing on the wrong tool (tests/recommend.test.cjs checks every path is a tool).
 */
export const JOBS: Readonly<Record<string, string>> = Object.freeze({
  "text to speech": "/ai/speech", "tts": "/ai/speech", "read aloud": "/ai/speech", "voice over": "/ai/speech", "speak text": "/ai/speech",
  // 19 Nov 2026: plain-language TTS requests were misrouted by generic synonyms (article->news, text->document,
  // read->extract) — "turn my article into an mp3" hit /page/publish, "make an mp3 from text" hit /document/text,
  // "read this article aloud as audio" and "text to audio for my video" hit /transcribe (the wrong direction). These
  // whole-word phrases carry the buyer's output intent and win over the lexical score on all three finder surfaces.
  "into an mp3": "/ai/speech", "into mp3": "/ai/speech", "mp3 from text": "/ai/speech", "text to audio": "/ai/speech", "aloud as audio": "/ai/speech", "read aloud as": "/ai/speech",
  "long text to speech": "/text-to-speech", "narrate": "/text-to-speech", "narration": "/text-to-speech",
  "speech to text": "/transcribe", "transcribe": "/transcribe", "transcription": "/transcribe", "audio to text": "/transcribe",
  // 1.192.0 (Glyphcall Voice): the long, cheap and summary voice tools by the jobs buyers name.
  "podcast transcription": "/transcribe/long", "transcribe podcast": "/transcribe/long", "transcribe a podcast": "/transcribe/long", "transcribe meeting": "/transcribe/long", "long audio": "/transcribe/long", "transcribe interview": "/transcribe/long", "subtitles": "/transcribe/long", "srt": "/transcribe/long", "generate subtitles": "/transcribe/long", "elevenlabs speech to text": "/transcribe/long", "scribe": "/transcribe/long",
  "meeting notes": "/transcribe/summary", "meeting summary": "/transcribe/summary", "summarize audio": "/transcribe/summary", "summarize recording": "/transcribe/summary", "voice note": "/transcribe/summary", "voicemail": "/transcribe/summary", "call summary": "/transcribe/summary", "action items": "/transcribe/summary",
  "speaker diarization": "/transcribe/speakers", "speaker labels": "/transcribe/speakers", "who said what": "/transcribe/speakers", "diarization": "/transcribe/speakers", "interview transcript": "/transcribe/speakers", "redact transcript": "/transcribe/speakers", "translate subtitles": "/subtitles/translate", "subtitle translation": "/subtitles/translate", "translate srt": "/subtitles/translate", "translate captions": "/subtitles/translate", "dub video": "/dub", "dub audio": "/dub", "dubbing": "/dub", "voice over translation": "/dub", "translate voice": "/dub", "voice agent": "/voice/agent", "voice bot": "/voice/agent", "voice assistant": "/voice/agent", "conversational ai": "/voice/agent", "talk to ai": "/voice/agent", "podcast generator": "/dialogue", "multi speaker": "/dialogue", "dialogue audio": "/dialogue", "conversation audio": "/dialogue", "tts with subtitles": "/text-to-speech/captions", "voiceover with captions": "/text-to-speech/captions", "speech with subtitles": "/text-to-speech/captions",
  "cheap text to speech": "/text-to-speech/lite", "cheap tts": "/text-to-speech/lite",
  // 1.208.0: speech, dubbing and the voice agent in French, Chinese, Japanese and Korean (MeloTTS).
  "french text to speech": "/ai/speech", "french tts": "/ai/speech", "chinese text to speech": "/ai/speech", "chinese tts": "/ai/speech", "mandarin tts": "/ai/speech",
  "japanese text to speech": "/ai/speech", "japanese tts": "/ai/speech", "korean text to speech": "/ai/speech", "korean tts": "/ai/speech", "spanish text to speech": "/ai/speech",
  "dub to french": "/dub", "dub to spanish": "/dub", "dub to japanese": "/dub", "dub to chinese": "/dub", "dub to korean": "/dub", "translate video to french": "/dub", "translate audio to spanish": "/dub",
  "smart contract audit": "/audit/contract", "contract audit": "/audit/contract", "audit contract": "/audit/contract", "audit smart contract": "/audit/contract", "solidity audit": "/audit/contract", "audit solidity": "/audit/contract", "contract security review": "/audit/contract", "security audit": "/audit/contract", "code audit": "/audit/contract",
  "website audit": "/audit/website", "site audit": "/audit/website", "audit bundle": "/audit/website", "accessibility audit": "/audit/website", "page speed": "/audit/website", "lighthouse": "/audit/website",
  "seo audit": "/seo/audit", "package audit": "/package-audit", "dependency audit": "/package-audit",
  // 10 Nov 2026 (base-bots/mercator-jobs.mjs, bazaar-word-demand.mjs): jobs sold elsewhere under a path that names them.
  "cve lookup": "/cve", "cve": "/cve", "vulnerability lookup": "/cve", "known exploited": "/cve", "kev": "/cve", "epss": "/cve", "cvss score": "/cve",
  "timezone convert": "/time", "time zone converter": "/time", "current time": "/time", "what time is it": "/time", "time in": "/time", "what time": "/time",
  "perp funding": "/hyperliquid/market", "funding rate": "/hyperliquid/market", "open interest": "/hyperliquid/market",
  "income statement": "/sec/financials", "balance sheet": "/sec/financials", "cash flow statement": "/sec/financials", "financial statements": "/sec/financials", "company financials": "/sec/financials", "stock fundamentals": "/sec/financials", "fundamentals": "/sec/financials", "company facts": "/sec/financials", "earnings per share": "/sec/financials",
  "arxiv": "/arxiv/search", "arxiv search": "/arxiv/search", "preprint": "/arxiv/search", "preprints": "/arxiv/search",
  "url to markdown": "/extract", "page to markdown": "/extract", "html to markdown": "/extract",
  "javascript page": "/extract/rendered", "rendered page": "/extract/rendered", "spa page": "/extract/rendered", "js rendered": "/extract/rendered", "dynamic page": "/extract/rendered", "client side rendered": "/extract/rendered",  "wikipedia summary": "/wikipedia", "wiki summary": "/wikipedia", "trending crypto": "/crypto/trending", "trending coins": "/crypto/trending", "crypto ohlcv": "/hyperliquid/candles", "crypto candles": "/hyperliquid/candles",
  "macro economic data": "/econ/snapshot", "economic indicators": "/econ/snapshot", "country economic data": "/econ/snapshot", "gdp inflation unemployment population": "/econ/snapshot",
  "web search": "/search", "search the web": "/search", "google search": "/search", "serp": "/search", "brave search": "/search", "exa search": "/search",
  "keyword ideas": "/keywords/ideas", "keyword research": "/keywords/ideas", "keyword overview": "/keywords/ideas",
  "email verifier": "/email", "verify email": "/email", "email verification": "/email", "email validation": "/email",
  "lead verification": "/pack/contact-verify", "contact verification": "/pack/contact-verify", "verify contact": "/pack/contact-verify", "lead qualification": "/pack/contact-verify", "verify lead": "/pack/contact-verify",
  "vendor check": "/pack/vendor-check", "supplier due diligence": "/pack/vendor-check", "vendor due diligence": "/pack/vendor-check", "vendor screening": "/pack/vendor-check", "supplier check": "/pack/vendor-check", "verify supplier": "/pack/vendor-check", "supplier verification": "/pack/vendor-check", "check supplier": "/pack/vendor-check", "vet supplier": "/pack/vendor-check", "verify vendor": "/pack/vendor-check", "swedish supplier": "/se/company", "supplier in sweden": "/se/company", "norwegian supplier": "/no/company", "supplier in norway": "/no/company", "finnish supplier": "/fi/company", "supplier in finland": "/fi/company", "french supplier": "/fr/company", "supplier in france": "/fr/company",
  "email auth": "/pack/email-deliverability", "spf": "/pack/email-deliverability", "dmarc": "/pack/email-deliverability", "dkim": "/pack/email-deliverability", "ssl certificate check": "/http/security-headers", "tls check": "/http/security-headers", "security headers": "/http/security-headers", "smtp settings": "/email",
  "fear and greed": "/crypto/fear-greed", "fear greed": "/crypto/fear-greed",
  "token price": "/price/token", "crypto price": "/price/token", "coin price": "/price/token",
  "who bought": "/token/buyers", "who sold": "/token/buyers", "token flow": "/token/flow", "net flow": "/token/flow", "flow intelligence": "/token/flow", "token flows": "/pack/token-flows",
  "daily brief": "/pack/daily-brief", "market brief": "/pack/daily-brief", "morning brief": "/pack/daily-brief", "gas oracle": "/pack/gas-tracker", "gas tracker": "/pack/gas-tracker", "multichain gas": "/pack/gas-tracker",
  "erc20 balance": "/base/token-balance", "token balance": "/base/token-balance", "wallet balance": "/wallet/balances", "wallet token balances": "/wallet/balances", "wallet portfolio": "/wallet/portfolio",
  "weather forecast": "/weather", "current weather": "/weather",
  "phishing check": "/phishing/check", "phishing domain": "/phishing/check", "phishing blocklist": "/phishing/check", "url safety": "/pack/url-safety", "is this link safe": "/pack/url-safety", "scam url": "/pack/url-safety", "merchant trust": "/domain-report", "is this site legit": "/domain-report",
  "screenshot": "/screenshot", "status check": "/url/uptime", "uptime": "/url/uptime", "is it down": "/url/uptime",
  "image generation": "/image", "generate image": "/image", "image gen": "/image",
  "chat completion": "/ai/chat", "chat completions": "/ai/chat", "chat with an ai": "/ai/chat", "chat with ai": "/ai/chat", "llm": "/ai/chat",
  "rug check": "/token/verdict", "honeypot": "/token/verdict", "token preflight": "/token/verdict", "token verdict": "/token/verdict",
  "wallet screen": "/sanctions/check", "sanctions check": "/sanctions/check", "ofac": "/sanctions/check",
  "company lookup": "/company", "company enrich": "/pack/domain-intel", "company enrichment": "/pack/domain-intel",
  // 12 Nov 2026: the national registers, by the names buyers use for them and their company numbers.
  "swedish company": "/se/company", "organisationsnummer": "/se/company", "bolagsverket": "/se/company", "sweden company": "/se/company", "registration number sweden": "/se/company", "registration number norway": "/no/company", "registration number finland": "/fi/company", "registration number france": "/fr/company",
  "norwegian company": "/no/company", "organisasjonsnummer": "/no/company", "brreg": "/no/company", "norway company": "/no/company",
  "finnish company": "/fi/company", "ytunnus": "/fi/company", "y tunnus": "/fi/company", "finland company": "/fi/company",
  "czech company": "/cz/company", "czechia company": "/cz/company", "ico number": "/cz/company", "ares register": "/cz/company",
  "estonian company": "/ee/company", "estonia company": "/ee/company", "registrikood": "/ee/company", "ariregister": "/ee/company",
  "french company": "/fr/company", "siren": "/fr/company", "siret": "/fr/company", "sirene": "/fr/company", "france company": "/fr/company",
  "rss": "/feed", "feed json": "/feed", "pdf to text": "/pdf/text", "web page to markdown": "/extract", "scrape": "/extract",
  // 19 Nov 2026: "extract text from a website" was hijacked by the generic `text→document` synonym to /pdf/text (a
  // website URL is not a PDF and fails there); "summarize a long article" by `article→news` to /news. Both are paid
  // jobs with a direct tool, and both were lost at the free finder.
  "extract text from a website": "/extract", "text from a website": "/extract", "read a web page": "/extract", "summarize a long article": "/summarize", "summarize this article": "/summarize", "summarize a web page": "/summarize",
  // 19 Nov deep audit: five whole-word phrases still routed to a wrong (sometimes 6x pricier or 415-failing) paid tool
  // on all three finder surfaces (/find, MCP find_tool, /recommend fallback). Fix once here for all of them.
  "read a pdf": "/pdf/text", "read a pdf file": "/pdf/text", "read pdf": "/pdf/text", "extract text from pdf": "/pdf/text",
  "full text of this webpage": "/extract", "full text of this page": "/extract", "webpage text": "/extract", "web page text": "/extract", "page text": "/extract",
  "look up a company": "/company", "look up company information": "/company", "company information": "/company", "company details": "/company",
  "domain owner": "/whois/lookup", "who owns this domain": "/whois/lookup", "domain whois": "/whois/lookup", "registrar lookup": "/whois/lookup",
  "prediction markets": "/polymarket/markets", "polymarket": "/polymarket/markets",
  "stock price": "/stock/quote", "stock quote": "/stock/quote", "share price": "/stock/quote", "shares price": "/stock/quote", "equity price": "/stock/quote", "price of a stock": "/stock/quote", "price of a share": "/stock/quote", "company share price": "/stock/quote", "stock history": "/stock/history", "ohlcv": "/hyperliquid/candles",
  "github repo": "/github/repo", "github repository": "/github/repo",
  "contract call": "/base/call", "eth call": "/base/call", "read contract": "/base/call",
  "vat number": "/vat/validate", "vat validation": "/vat/validate", "validate vat": "/vat/validate", "lei": "/lei/lookup",
  // 19 Nov 2026: four jobs that "validate iban", "llm pricing" and "block explorer" used to route to the wrong (and
  // sometimes pricier) tool. Whole-word phrases win over the lexical score on all three finder surfaces.
  "iban": "/validate/iban", "validate iban": "/validate/iban", "iban check": "/validate/iban", "iban validator": "/validate/iban",
  "llm pricing": "/llm/prices", "model prices": "/llm/prices", "model pricing": "/llm/prices", "llm prices": "/llm/prices",
  "block explorer": "/base/block", "block height": "/base/block", "blockchain explorer": "/base/block",
  "invoice check": "/invoice/check", "check invoice": "/invoice/check", "invoice validation": "/invoice/check", "invoice fraud": "/invoice/check", "invoice parser": "/document/extract",
  "my ip": "/ip/geolocate", "ip geolocation": "/ip/geolocate", "ip location": "/ip/geolocate", "ip lookup": "/ip/lookup", "ip whois": "/ip/lookup",
  "national debt": "/econ/national-debt", "usdc yield": "/defi/yields", "defi yields": "/defi/yields", "tvl": "/defi/tvl",
  // Business packs (16 Nov 2026, routes/packs-business.ts).
  "should i pay": "/pack/counterparty-full", "should my agent pay": "/pack/counterparty-full", "safe to pay": "/pack/counterparty-full", "pay this counterparty": "/pack/counterparty-full", "full counterparty check": "/pack/counterparty-full", "counterparty due diligence": "/pack/counterparty-full", "seller due diligence": "/pack/counterparty-full", "vet a seller": "/pack/counterparty-full",
  "e invoice check": "/pack/einvoice-check", "einvoice check": "/pack/einvoice-check", "check e invoice": "/pack/einvoice-check", "e invoice usable": "/pack/einvoice-check", "xrechnung check": "/pack/einvoice-check", "check xrechnung": "/pack/einvoice-check", "zugferd check": "/pack/einvoice-check", "check zugferd": "/pack/einvoice-check",
});
/** The tool for the longest job phrase the request holds as whole words, if any. */
export function jobTool(needText: string): string | undefined {
  const text = ` ${asWritten(needText)} `;
  let best: string | undefined;
  for (const phrase of Object.keys(JOBS)) if (text.includes(` ${phrase} `) && (!best || phrase.length > best.length)) best = phrase;
  return best ? JOBS[best] : undefined;
}

/**
 * Lexical score: a query word in the listing name counts most, then tags, then the summary, then the description.
 * `written` is the request as the caller wrote it (1.110.1): the stop-word-free word list scored "text to speech" and
 * "speech to text" the same, so the free finder answered /transcribe for a text-to-speech job. A name or tag that holds
 * the phrase in the caller's own word order wins.
 */
export function lexicalScore(query: string[], d: Doc, written = "") {
  if (!query.length) return 0;
  // A trailing boundary matters: without it the token "no" prefix-matched every "nonce" tool, so a nonsense request
  // came back with paid nonce calls (19 Nov 2026, found through the A2A endpoint's no-match test). Keep the common
  // inflections so light stems still match ("sanction" -> "sanctions", "fee" -> "fees") without matching "nonce".
  const has = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.$]/g, "\\$&")}(ing|ed|es|s)?([^a-z0-9]|$)`).test(text);
  const name = asWritten(d.name), tags = `${d.tags.join(" ").toLowerCase().replace(/-/g, " ")} ${d.also ?? ""}`, summary = d.summary.toLowerCase(), desc = d.description.toLowerCase();
  let s = 0;
  for (const w of query) s += has(name, w) ? 4 : has(tags, w) ? 3 : has(summary, w) ? 2 : has(desc, w) ? 1 : 0;
  // The whole request as a phrase in the name or tags (e.g. "token price", "dns lookup").
  const phrase = query.join(" ");
  if (query.length > 1 && (name.includes(phrase) || tags.includes(phrase))) s += 4;
  if (written.includes(" ")) s += name.startsWith(written) ? 8 : name.includes(written) ? 6 : tags.includes(written) ? 5 : 0;
  return s / query.length;
}

async function catalog(): Promise<{ docs: Doc[]; example: (path: string) => [string, { example?: unknown; required?: boolean; description: string }][]; free: (path: string) => boolean }> {
  const [{ ENDPOINTS, exampleParams }, { listingName, listingTags }, { CAPACITY_LIMITED }, { ENTRY_OF }] = await Promise.all([import("../endpoints"), import("../lib/bazaar-extension"), import("../lib/capacity"), import("./entry-paths")]);
  const byPath = new Map(ENDPOINTS.map((e) => [e.path, e]));
  // Entry paths (7 Nov 2026) are doors for outside search engines; our own recommender names the canonical tool only.
  const canonical = (e: { path: string }) => !Object.hasOwn(ENTRY_OF, e.path);
  // Each door was named for a phrase buyers search ("USDC yield", "Current weather"): the tool it runs answers to it too.
  const also = new Map<string, string[]>();
  for (const e of ENDPOINTS) if (!canonical(e)) (also.get(ENTRY_OF[e.path]) ?? also.set(ENTRY_OF[e.path], []).get(ENTRY_OF[e.path])!).push(asWritten(listingName(e.summary)), ...listingTags(e.tags, e.path).map((tag) => tag.toLowerCase().replace(/-/g, " ")));
  return {
    docs: ENDPOINTS.filter((e) => e.path !== "/recommend" && canonical(e)).map((e) => ({ path: e.path, name: listingName(e.summary), tags: listingTags(e.tags, e.path), summary: e.summary, description: e.description, price: e.price, also: (also.get(e.path) ?? []).join(" , ") })),
    example: (path) => exampleParams(byPath.get(path as never)!) as never,
    free: (path) => !CAPACITY_LIMITED.has(path),
  };
}

/**
 * `rerank` null is the free finder (GET /find, 1.110.0): word matching only, so it costs nothing to run and an agent can
 * ask which of our tools does its next job without paying or leaving. `origin` is the host the caller used.
 */
export async function recommend(env: Env, needText: string, count: number, rerank: ((q: string, docs: string[]) => Promise<number[] | null>) | null, origin = ORIGIN) {
  const query = tokens(needText);
  if (!query.length) throw new HttpError(400, "describe the task in a few plain words, for example need=current gas price on Base");
  const { docs, example, free } = await catalog();
  const written = asWritten(needText);
  const job = jobTool(needText);
  const ranked = docs.map((d) => ({ d, s: lexicalScore(query, d, written) + (d.path === job ? 10 : 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 15);
  if (!ranked.length) throw new HttpError(404, `no tool here matches "${needText.slice(0, 80)}"; nothing was charged. The full catalog is at ${origin}/discovery/resources`);
  let order = ranked;
  let method = "lexical";
  if (rerank && ranked.length > 1) {
    const scores = await rerank(needText, ranked.map(({ d }) => `${d.name}. ${d.summary}. ${d.description.slice(0, 400)}`)).catch(() => null);
    if (scores && scores.length === ranked.length) {
      // Blend: the reranker reads meaning, the lexical score keeps exact task names (a tool named for the phrase) on top.
      const top = ranked[0].s;
      // A named job keeps its tool first: the reranker reads "text to speech" and "speech to text" as near twins.
      order = ranked.map((x, i) => ({ ...x, s: 0.7 * scores[i] + 0.3 * (x.s / top) + (x.d.path === job ? 1 : 0) })).sort((a, b) => b.s - a.s);
      method = "lexical+rerank";
    }
  }
  const picks = order.slice(0, count).map(({ d, s }) => {
    const params = example(d.path);
    const query = new URLSearchParams(params.filter(([, p]) => p.example !== undefined && p.example !== "").map(([n, p]) => [n, String(p.example)])).toString();
    return {
      tool: d.path,
      name: d.name,
      what: d.summary,
      price: d.price,
      mcpTool: d.path.slice(1).replace(/[/-]/g, "_"),
      call: { method: "GET", url: `${origin}${d.path}${query ? `?${query}` : ""}` },
      requiredInputs: params.filter(([, p]) => p.required).map(([n, p]) => ({ name: n, description: p.description })),
      inFreeCalls: free(d.path),
      score: Math.round(s * 1000) / 1000,
    };
  });
  return {
    need: needText,
    picks,
    howToPay: `GET the call URL: unpaid it answers 402 with x402 terms (USDC on Base, Polygon, Arbitrum or Solana) and MPP; or send a prepaid key as Authorization: Bearer (by card at ${origin}/credits, or with USDC at ${origin}/credits/usdc/5). Failed calls are never charged; the first 3 calls per caller are free over HTTP on tools in the free calls (add trial=1).`,
    mcp: `${origin}/mcp`,
    method,
  };
}


/**
 * The market-wide half of "which API should I call?". The original /recommend only searched our own catalog, so a
 * buyer comparing sellers had no reason to pay for it (Agents Trust earns $188.21/30 d from 59 payers for this job).
 * This searches the whole public Bazaar, maps listings with the same function /x402/find uses, and orders them by
 * capability (Bazaar relevance, in bands of five), then evidence (30-day payers, calls, recency), then price.
 * Our own listings are marked and compete on exactly those fields - never boosted. No match means no charge.
 */
const BAZAAR_SEARCH = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";

async function searchBazaar(query: string): Promise<BazaarItem[]> {
  const data = await getJson<{ resources?: BazaarItem[]; items?: BazaarItem[] }>(
    `${BAZAAR_SEARCH}?${new URLSearchParams({ query, limit: "20" })}`, { timeoutMs: 10_000 });
  return data.resources ?? data.items ?? [];
}

export async function marketRecommend(
  env: Env,
  needText: string,
  count: number,
  maxPrice?: number,
  networks?: string[],
  search: (q: string) => Promise<BazaarItem[]> = searchBazaar,
) {
  const task = needText.trim();
  if (task.length < 3 || task.length > 300) throw new HttpError(400, "describe the task in 3 to 300 plain words");
  const items = await search(task).catch(() => [] as BazaarItem[]);
  let rows = items.map((it) => listing(it, env.PAY_TO ?? "")).filter((r) => r.url && r.priceUsd !== null);
  if (maxPrice !== undefined) rows = rows.filter((r) => (r.priceUsd ?? Infinity) <= maxPrice);
  if (networks?.length) rows = rows.filter((r) => r.networks.some((n) => networks.includes(n)));

  // If the market has nothing usable, fall back to our own catalog but say so in the answer.
  if (!rows.length) {
    const own = await recommend(env, task, count, null).catch(() => null);
    if (!own) throw new HttpError(404, `no tool matches "${task.slice(0, 80)}"; nothing was charged`);
    return {
      need: task,
      market: { searched: items.length, eligible: 0, returned: own.picks.length, source: "own-catalog" },
      picks: own.picks.map((p, i) => ({
        rank: i + 1, name: p.name, resource: p.call.url, method: p.call.method,
        priceUsd: Number(String(p.price).replace("$", "")), networks: [] as string[],
        payers30d: null, calls30d: null, lastCalledAt: null,
        evidence: [`our catalog: ${p.price}`],
        why: "Our own tool for this task; no market listing matched.", ours: true,
      })),
      howToPay: own.howToPay,
      method: "own-catalog",
    };
  }

  const ranked = rows
    .map((r, i) => ({ r, i, band: Math.floor(i / 5) }))
    .sort((a, b) => a.band - b.band
      || (b.r.payers30d ?? 0) - (a.r.payers30d ?? 0)
      || (b.r.calls30d ?? 0) - (a.r.calls30d ?? 0)
      || String(b.r.lastCalledAt ?? "").localeCompare(String(a.r.lastCalledAt ?? ""))
      || (a.r.priceUsd ?? Infinity) - (b.r.priceUsd ?? Infinity)
      || a.i - b.i);
  const picks = ranked.slice(0, count).map(({ r, i }, n) => {
    const evidence = [`Bazaar relevance #${i + 1}`];
    if (r.payers30d != null) evidence.push(`${r.payers30d} payers in 30d`);
    if (r.calls30d != null) evidence.push(`${r.calls30d} calls in 30d`);
    if (r.lastCalledAt) evidence.push(`last paid ${r.lastCalledAt}`);
    evidence.push(`${r.priceUsd} on ${r.networks.join(", ") || "x402"}`);
    if (r.ours) evidence.push("our listing, marked not boosted");
    return {
      rank: n + 1, name: r.name, resource: r.url, method: r.method ?? "GET",
      priceUsd: r.priceUsd, networks: r.networks, payers30d: r.payers30d,
      calls30d: r.calls30d, lastCalledAt: r.lastCalledAt, evidence,
      why: r.ours ? "Our own listing competes on the same evidence; it is not boosted." : `A paid API for this task, paid by ${r.payers30d ?? 0} wallets in 30 days.`,
      ours: !!r.ours,
    };
  });
  return {
    need: task,
    market: { searched: items.length, eligible: rows.length, returned: picks.length, source: "bazaar" },
    picks,
    howToPay: "GET the resource URL: unpaid it answers 402 with x402 terms (USDC on Base and other networks) and MPP; pay the seller directly. We never take custody. No picks means no charge.",
    method: "market+evidence",
  };
}

export const RECOMMEND: Entry[] = [
  entry("/recommend", "API recommendation: compare paid APIs for a task",
    "Describe a task in plain words and compare up to five paid APIs for it across the whole Coinbase Bazaar: each pick with the exact URL to call, method, price in USD, networks, 30-day payers and calls, last paid date and the evidence behind the order. Our own listings are marked, never boosted. No matching tool means no charge. Use when an agent must choose which API to call before paying one.",
    ["api-recommendation", "which-api", "which-api-to-call", "compare-apis", "find-api", "api-discovery", "x402-discovery"], {
      need: { type: "string", description: "The task in plain words, 3 to 300 characters", required: true, example: "check whether a Base token is a honeypot" },
      count: { type: "string", description: "How many picks, 1 to 5 (default 3)", example: "3" },
      maxPrice: { type: "number", description: "Only listings at or under this price in USD", example: 0.05 },
      networks: { type: "string", description: "Comma-separated networks: base, polygon, arbitrum, solana", example: "base" },
    },
    {
      need: "check whether a Base token is a honeypot",
      market: { searched: 20, eligible: 7, returned: 1, source: "bazaar" },
      picks: [{
        rank: 1, name: "Honeypot token check, token risk", resource: `${ORIGIN}/token-report?address=0x...`, method: "GET",
        priceUsd: 0.01, networks: ["base"], payers30d: 4, calls30d: 1160, lastCalledAt: "2026-11-19T05:51:13Z",
        evidence: ["Bazaar relevance #2", "4 payers in 30d", "1,160 calls in 30d", "$0.01 on base", "our listing, marked not boosted"],
        why: "Our own listing competes on the same evidence; it is not boosted.", ours: true,
      }],
      howToPay: "GET the resource URL: unpaid it answers 402 with x402 terms (USDC on Base and other networks) and MPP; pay the seller directly. We never take custody. No picks means no charge.",
      method: "market+evidence",
    },
    (env, q) => {
      const task = need(q, "need", 300);
      const count = num(q, "count", { min: 1, max: 5, fallback: 3, integer: true });
      const maxPrice = q("maxPrice") === undefined || q("maxPrice") === "" ? undefined : num(q, "maxPrice", { min: 0, max: 1000 });
      const nets = opt(q, "networks", 80)?.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
      return marketRecommend(env, task, count, maxPrice, nets);
    },
    "$0.01"),
];
