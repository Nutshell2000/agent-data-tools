// The front page of the product site (glyphcall.com), for people. Served at "/" only when the owner has set a public
// brand (PUBLIC_BRAND, lib/public-brand.ts); until then "/" stays the agent catalogue, which is always at /agents.
//
// Owner, 15 Nov 2026: "make our great homepage that beats ElevenLabs, Exa, everybody's homepages ... must draw in a lot
// of customers", and "no personal information, only market Glyphcall".
//
// Rules for this page (the same as the comparison and benchmark pages it links):
// - Every number is computed from the catalog, the plans, STT_RIVALS / TTS_RIVALS (each rival figure copied from the
//   rival's own pricing page on VOICE_CHECKED, linked) or a recorded benchmark run (BENCHMARKS). Never type a number.
// - Say where a rival is better: OpenAI's tts-1 costs less per character than our cheapest voice, ElevenLabs has far
//   more voices and languages, and Exa wins the research-paper benchmark.
// - No payment protocol, wallet or crypto word before the "For AI agents" section (tests/site-pages.test.cjs).
// - No script: the code tabs are radio inputs, the motion is CSS and stops under prefers-reduced-motion.
import { ENDPOINTS, exampleParams, type Endpoint } from "../endpoints";
import { BENCHMARKS, BENCHMARKS_PATH } from "./benchmarks-page";
import { PLAN_PORTAL_URL } from "./credits";
import { FREE_CALLS_PER_CALLER } from "./free-calls";
import { COMPANY_FOOTER } from "./legal";
import { PRODUCTS, productOffers, type Product } from "./product-pages";
import { STT_RIVALS, TTS_RIVALS, VOICE_CHECKED, ourVoice } from "./voice-compare";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const BY_PATH = new Map(ENDPOINTS.map((e) => [e.path, e as Endpoint]));
const queryOf = (e: Endpoint) => exampleParams(e).map(([k, p]) => `${k}=${encodeURIComponent(String(p.example ?? ""))}`).join("&");
/** $0.05, $0.20, $0.258, $1.50: two decimals, a third only when it carries a digit. */
const money = (n: number) => `$${n.toFixed(3).replace(/(\.\d\d)0$/, "$1")}`;

/** The free in-browser tools on their own subdomains (Cloudflare Pages projects glyphcall-voice and glyphcall-studio). */
export const VOICE_SITE = "https://voice.glyphcall.com";
export const STUDIO_SITE = "https://studio.glyphcall.com";

/** Which shelf of the page each product sits on. A product not named here lands on the last shelf. */
const SHELVES: readonly { id: string; kicker: string; title: string; lead: string; slugs: readonly string[] }[] = [
  { id: "voice", kicker: "Voice", title: "Speech to text and text to speech", lead: "Transcripts, subtitles and word timings from any recording. Natural voices back from your text. Drop-in shapes for the APIs you already call.", slugs: ["speech-to-text-api", "text-to-speech-api"] },
  { id: "documents", kicker: "Documents", title: "Any file or page, as clean text or fields", lead: "PDFs, Word, Excel, scans, photos and web pages in; Markdown, text or the exact fields you asked for out.", slugs: ["pdf-to-text-api", "document-to-text-api", "invoice-data-extraction-api", "web-page-to-markdown-api"] },
  { id: "search", kicker: "Search and checks", title: "Search that knows Europe", lead: "EU law article by article, companies in official registers, VAT numbers and sanctions lists. Exa-compatible requests.", slugs: ["exa-alternative-api", "eu-law-search-api", "company-check-api", "eu-sanctions-screening-api"] },
];

const ICON: Record<string, string> = {
  voice: `<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>`,
  documents: `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`,
};
const icon = (id: string) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[id] ?? ICON.search}</svg>`;

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="gc-logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#gc-logo)"/><g fill="#0a0a12"><rect x="7" y="13" width="3" height="6" rx="1.5"/><rect x="12" y="9" width="3" height="14" rx="1.5"/><rect x="17" y="5" width="3" height="22" rx="1.5"/><rect x="22" y="11" width="3" height="10" rx="1.5"/></g></svg>`;

const STYLE = `:root{color-scheme:dark;--bg:#07070c;--bg2:#0d0d16;--card:#11111c;--card2:#161624;--line:#25253a;--fg:#f4f4fb;--muted:#a3a3bf;--dim:#73738f;--v:#8b5cf6;--c:#22d3ee;--g:#34d399;--grad:linear-gradient(100deg,#a78bfa 0%,#22d3ee 100%)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:var(--c);text-decoration:none}a:hover{text-decoration:underline}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:1160px;margin:0 auto;padding:0 16px}
.glow{position:absolute;inset:-200px 0 auto 0;height:900px;pointer-events:none;background:radial-gradient(600px 380px at 18% 20%,rgba(139,92,246,.30),transparent 70%),radial-gradient(560px 360px at 82% 8%,rgba(34,211,238,.20),transparent 70%);z-index:0}
.grid-bg{position:absolute;inset:0;height:820px;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse at 50% 0,#000 30%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse at 50% 0,#000 30%,transparent 75%);z-index:0}
header.nav{position:sticky;top:0;z-index:20;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);background:rgba(7,7,12,.72);border-bottom:1px solid rgba(255,255,255,.06)}
header.nav .wrap{display:flex;align-items:center;gap:18px;height:64px}
.home{display:flex;align-items:center;gap:10px}.logo{width:30px;height:30px;flex:none}a.brand{color:var(--fg);font-weight:800;font-size:1.15rem;letter-spacing:-.01em}a.brand:hover{text-decoration:none}
header.nav nav{display:flex;gap:4px;margin-left:12px}header.nav nav a{color:var(--muted);padding:8px 12px;border-radius:8px;font-size:.95rem}header.nav nav a:hover{color:var(--fg);background:rgba(255,255,255,.05);text-decoration:none}
.nav-cta{margin-left:auto;display:flex;gap:8px;align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;border-radius:12px;font-weight:650;font-size:1rem;border:1px solid var(--line);color:var(--fg);background:rgba(255,255,255,.03);transition:transform .15s,border-color .15s,background .15s;white-space:nowrap}
.btn:hover{text-decoration:none;border-color:#3a3a58;background:rgba(255,255,255,.06);transform:translateY(-1px)}
.btn.primary{border:0;color:#07070c;background:var(--grad);box-shadow:0 8px 30px -8px rgba(139,92,246,.6)}.btn.primary:hover{filter:brightness(1.08)}
.btn.sm{padding:8px 14px;font-size:.9rem;border-radius:10px}
section{position:relative;z-index:1}
.hero{padding:72px 0 40px}.hero .wrap{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center}
.pill{display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);font-size:.88rem}
.pill b{color:#07070c;background:var(--grad);padding:2px 9px;border-radius:999px;font-size:.78rem;letter-spacing:.02em}
h1{font-size:clamp(2.4rem,5.6vw,4.3rem);line-height:1.02;letter-spacing:-.035em;margin:20px 0 18px;font-weight:850}
.gt{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lede{font-size:clamp(1.06rem,1.6vw,1.24rem);color:var(--muted);max-width:56ch;margin:0 0 28px}.lede strong{color:var(--fg);font-weight:650}
.ctas{display:flex;flex-wrap:wrap;gap:12px}
.trust{display:flex;flex-wrap:wrap;gap:8px 20px;margin:26px 0 0;padding:0;list-style:none;color:var(--muted);font-size:.92rem}.trust li::before{content:"\\2713";color:var(--g);font-weight:800;margin-right:7px}
.term{position:relative;border-radius:18px;background:linear-gradient(180deg,#141422,#0c0c15);border:1px solid var(--line);box-shadow:0 30px 80px -30px rgba(34,211,238,.25),0 0 0 1px rgba(255,255,255,.02) inset;overflow:hidden}
.term::before{content:"";position:absolute;inset:-1px;border-radius:18px;padding:1px;background:linear-gradient(140deg,rgba(139,92,246,.7),transparent 40%,transparent 60%,rgba(34,211,238,.6));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.wave{display:flex;align-items:center;justify-content:center;gap:4px;height:92px;padding:0 18px;border-bottom:1px solid var(--line);background:radial-gradient(400px 90px at 50% 50%,rgba(139,92,246,.18),transparent)}
.wave i{display:block;width:4px;border-radius:4px;background:var(--grad);animation:wv 1.4s ease-in-out infinite;opacity:.9}
@keyframes wv{0%,100%{height:12%}50%{height:80%}}
.tabs{display:flex;gap:2px;padding:10px 10px 0;flex-wrap:wrap}.tabs input{position:absolute;opacity:0;pointer-events:none}
.tabs label{cursor:pointer;padding:8px 13px;border-radius:9px 9px 0 0;color:var(--dim);font-size:.86rem;font-weight:600}
.tabs label:hover{color:var(--fg)}
.panes{border-top:1px solid var(--line)}.pane{display:none}
#t1:checked~.panes .p1,#t2:checked~.panes .p2,#t3:checked~.panes .p3{display:block}
#t1:checked~label[for=t1],#t2:checked~label[for=t2],#t3:checked~label[for=t3]{color:var(--fg);background:rgba(255,255,255,.05);box-shadow:inset 0 -2px 0 var(--c)}
#t1:focus-visible~label[for=t1],#t2:focus-visible~label[for=t2],#t3:focus-visible~label[for=t3]{outline:2px solid var(--c)}
.pane pre{margin:0;padding:18px 20px 8px;font-size:.84rem;line-height:1.7;color:#d6d6ea;white-space:pre-wrap;word-break:break-all}
.pane pre .k{color:#c4b5fd}.pane pre .s{color:#67e8f9}.pane pre .c{color:var(--dim)}
.pane .out{margin:0 20px 18px;padding:10px 12px;border-radius:10px;background:rgba(52,211,153,.07);border:1px solid rgba(52,211,153,.25);color:#a7f3d0;font-size:.84rem}
.stats{padding:28px 0 18px}.stats .wrap{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.stat{padding:22px;border-radius:16px;border:1px solid var(--line);background:linear-gradient(180deg,var(--card),var(--bg2))}
.stat .n{font-size:clamp(1.9rem,3.4vw,2.6rem);font-weight:850;letter-spacing:-.03em;line-height:1.05}
.stat .l{color:var(--fg);font-weight:600;margin:8px 0 4px}.stat .s{color:var(--dim);font-size:.85rem}.stat .s a{color:var(--muted);text-decoration:underline;text-decoration-color:#3a3a58}
.sec{padding:84px 0 0}.kicker{color:var(--c);font-weight:700;font-size:.85rem;letter-spacing:.12em;text-transform:uppercase}
h2{font-size:clamp(1.8rem,3.6vw,2.8rem);line-height:1.08;letter-spacing:-.03em;margin:10px 0 14px;font-weight:820;max-width:24ch}
.sub{color:var(--muted);font-size:1.1rem;max-width:62ch;margin:0 0 34px}
.shelf{margin:0 0 56px}.shelf-head{display:flex;align-items:center;gap:12px;margin:0 0 6px}
.ico{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.shelf-head .badge{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:rgba(139,92,246,.14);color:#c4b5fd;border:1px solid rgba(139,92,246,.3)}
.shelf-head h3{font-size:1.4rem;margin:0;letter-spacing:-.015em}
.shelf>p{color:var(--muted);margin:4px 0 18px 52px;max-width:70ch}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.card{position:relative;display:flex;flex-direction:column;padding:22px;border-radius:16px;border:1px solid var(--line);background:var(--card);transition:transform .18s,border-color .18s,background .18s}
.card:hover{transform:translateY(-3px);border-color:#3b3b5c;background:var(--card2)}
.card h4{margin:0 0 8px;font-size:1.08rem;letter-spacing:-.01em}.card h4 a{color:var(--fg)}
.card p{color:var(--muted);margin:0 0 14px;font-size:.95rem;flex:1}.card .price{display:flex;justify-content:space-between;gap:10px;align-items:baseline;border-top:1px solid var(--line);padding-top:12px;font-size:.9rem}
.card .price b{font-size:1.05rem}.card p.from{flex:0;color:var(--dim);font-size:.85rem;margin:8px 0 0}.card .go{margin-top:12px;font-weight:650;font-size:.92rem}
.card a.cover{position:absolute;inset:0;border-radius:16px}.card a.cover:focus-visible{outline:2px solid var(--c)}
.vs{display:grid;grid-template-columns:1.25fr .75fr;gap:18px;align-items:start}
.table{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--card)}
.table .scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.95rem;min-width:520px}
th,td{text-align:left;padding:13px 16px;border-bottom:1px solid var(--line);vertical-align:middle}th{color:var(--dim);font-weight:600;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;background:rgba(255,255,255,.02)}
tr:last-child td{border-bottom:0}tr.us td{background:linear-gradient(90deg,rgba(139,92,246,.16),rgba(34,211,238,.06));font-weight:650}tr.us td:first-child{box-shadow:inset 3px 0 0 var(--v)}
.bar{height:8px;border-radius:8px;background:#26263a;min-width:60px}.bar span{display:block;height:100%;border-radius:8px;background:#4b4b6a}tr.us .bar span{background:var(--grad)}
.note{color:var(--dim);font-size:.86rem;padding:12px 16px;border-top:1px solid var(--line)}
.side{display:grid;gap:14px}.panel{padding:22px;border-radius:16px;border:1px solid var(--line);background:var(--card)}
.panel h3{margin:0 0 6px;font-size:1.1rem}.panel p{color:var(--muted);margin:0 0 10px;font-size:.95rem}
.duel{display:grid;gap:10px;margin:14px 0}.duel div{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center;font-size:.92rem}
.duel .bar{grid-column:1/-1;height:10px}.duel .us b{color:var(--fg)}
.honest{border-color:rgba(52,211,153,.3);background:linear-gradient(180deg,rgba(52,211,153,.06),var(--card))}.honest h3::before{content:"\\2696  ";}
.free{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.tool{padding:24px;border-radius:18px;border:1px solid var(--line);background:radial-gradient(500px 200px at 0 0,rgba(34,211,238,.10),transparent 60%),var(--card)}
.tool .tag{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--g);background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.25);padding:3px 9px;border-radius:999px}
.tool h3{margin:12px 0 6px;font-size:1.2rem}.tool p{color:var(--muted);margin:0 0 14px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;counter-reset:s;list-style:none;padding:0;margin:0 0 22px}
.steps li{counter-increment:s;padding:22px;border-radius:16px;border:1px solid var(--line);background:var(--card);color:var(--muted)}
.steps li::before{content:counter(s);display:grid;place-items:center;width:34px;height:34px;border-radius:10px;margin-bottom:12px;background:var(--grad);color:#07070c;font-weight:850}
.steps strong{display:block;color:var(--fg);font-size:1.06rem;margin-bottom:4px}
pre.code{margin:0;padding:18px 20px;border-radius:14px;border:1px solid var(--line);background:#0b0b13;color:#d6d6ea;font-size:.86rem;overflow-x:auto}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:18px}
.plan{padding:26px;border-radius:18px;border:1px solid var(--line);background:var(--card)}
.plan.best{border-color:transparent;background:linear-gradient(var(--card),var(--card)) padding-box,var(--grad) border-box;border:1px solid transparent;box-shadow:0 20px 60px -30px rgba(139,92,246,.6)}
.plan .p{font-size:2.4rem;font-weight:850;letter-spacing:-.03em}.plan .p small{font-size:1rem;color:var(--muted);font-weight:500}
.plan ul{list-style:none;padding:0;margin:14px 0 18px;color:var(--muted);font-size:.94rem}.plan li{padding:5px 0;border-bottom:1px dashed #23233a}.plan li b{color:var(--fg)}
.plan .btn{width:100%}.ribbon{float:right;font-size:.75rem;font-weight:700;color:#07070c;background:var(--grad);padding:3px 9px;border-radius:999px}
.packs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--muted);font-size:.94rem;margin:0 0 14px}.packs a{padding:7px 13px;border-radius:999px;border:1px solid var(--line);color:var(--fg)}.packs a:hover{border-color:var(--c);text-decoration:none}
details{border:1px solid var(--line);border-radius:14px;background:var(--card);margin:0 0 10px}summary{cursor:pointer;padding:16px 18px;font-weight:650;list-style:none}summary::-webkit-details-marker{display:none}
summary::after{content:"+";float:right;color:var(--c);font-weight:800}details[open] summary::after{content:"\\2212"}
details>div{padding:0 18px 16px;color:var(--muted)}details .scroll{overflow-x:auto}
.small{color:var(--dim);font-size:.88rem}
.faq{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.final{margin:96px 0 0;padding:64px 16px;text-align:center;border-top:1px solid var(--line);background:radial-gradient(700px 300px at 50% 0,rgba(139,92,246,.22),transparent 70%)}
.final h2{margin:0 auto 12px;max-width:20ch}.final p{color:var(--muted);margin:0 auto 26px;max-width:52ch;font-size:1.1rem}.final .ctas{justify-content:center}
.agents{margin-top:84px;padding:28px;border-radius:18px;border:1px dashed #33334d;background:rgba(255,255,255,.015)}.agents h2{font-size:1.5rem;margin-top:0}.agents p{color:var(--muted);margin:0}
footer{border-top:1px solid var(--line);margin-top:0;padding:40px 0 56px;color:var(--dim);font-size:.9rem}
footer .cols{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:24px;margin-bottom:26px}footer h4{color:var(--fg);margin:0 0 10px;font-size:.92rem}
footer ul{list-style:none;padding:0;margin:0}footer li{padding:3px 0}footer a{color:var(--muted)}footer .legal a{color:var(--muted)}
@media (max-width:960px){.hero .wrap,.vs{grid-template-columns:1fr}.stats .wrap{grid-template-columns:1fr 1fr}.steps{grid-template-columns:1fr}.faq{grid-template-columns:1fr}header.nav nav{display:none}footer .cols{grid-template-columns:1fr 1fr}}
@media (max-width:520px){.hero{padding-top:44px}.stats .wrap{grid-template-columns:1fr}.nav-cta .btn:not(.primary){display:none}.shelf>p{margin-left:0}.btn{padding:12px 16px}.ctas .btn{flex:1 1 100%}}
@media (prefers-reduced-motion:reduce){.wave i{animation:none;height:45%}.card,.btn{transition:none}html{scroll-behavior:auto}}`;

const shelfOf = (p: Product) => SHELVES.find((s) => s.slugs.includes(p.slug)) ?? SHELVES[SHELVES.length - 1];

function productCard(p: Product, cardReady: boolean): string {
  const tool = BY_PATH.get(p.tool);
  const lead = productOffers(p, cardReady).find((o) => o.monthly);
  return `<article class="card"><h4><a href="/${esc(p.slug)}">${esc(p.name)}</a></h4><p>${esc(p.tagline)}</p>`
    + `<div class="price"><span>Pay as you go</span><b>${tool ? `${esc(tool.price)} a call` : "See pricing"}</b></div>`
    + `${lead ? `<p class="from">${esc(lead.label)}: ${esc(lead.calls)} ${esc(p.unit)}</p>` : ""}`
    + `<span class="go">Try it free &rarr;</span><a class="cover" href="/${esc(p.slug)}" aria-label="${esc(p.name)}: code, free try and plans"></a></article>`;
}

/** The FAQ: every answer restates what the docs, the privacy page or the tool descriptions already say. */
function faqItems(brand: string, languages: string, cheapestStt: boolean): [q: string, a: string][] {
  return [
    ["Do I need an account?", `No. Every product page runs the real thing on your own input for free. When you want more, pay by card and your API key is shown straight away: no sign-up form, no sales call.`],
    ["What happens when a call fails?", `You pay nothing. Wrong input, a page that cannot be read or an outside source that is down are all free; only answers that succeed use credits.`],
    ["Is it cheaper than ElevenLabs, OpenAI or Exa?", `${cheapestStt ? `For transcription, yes: an hour of audio costs less with ${brand} than on any of the price lists compared on this page, each linked to the rival's own page.` : `Compare for yourself: every rival price on this page links to the rival's own price list.`} For text to speech, OpenAI's tts-1 is cheaper per character and ElevenLabs has far more voices; we say so on the comparison page.`],
    ["Will it work with the code I already have?", `The speech endpoints accept OpenAI- and ElevenLabs-shaped requests, the search endpoints accept Exa-shaped requests, and every tool is also one plain HTTPS request that returns JSON. AI assistants can connect through MCP.`],
    ["What happens to my files?", `The free browser tools never upload your file: it is processed on your own device. The PDF reader reads an uploaded file in memory for that one request and does not keep it. Everything else is on the privacy page.`],
    ["Which languages does transcription cover?", `${languages} Subtitles come back as SRT or VTT with word timings.`],
    ["Can I cancel a plan?", `Any time, from the plan portal, with the e-mail address you paid with. Unused credits stay on your key and one-off packs never expire.`],
    ["Is there a free tier?", `Yes: a free try on every product page, and the browser tools at voice.glyphcall.com and studio.glyphcall.com are free with no account.`],
  ];
}

/** The front page of the product site. `cardReady`: card plans and packs can be bought (lib/credit-routes.ts). */
export function landingPage(brand: string, origin: string, cardReady: boolean): string {
  const us = ourVoice();
  const scribe = STT_RIVALS.find((r) => r.name === "ElevenLabs");
  const flash = TTS_RIVALS.find((r) => r.name === "ElevenLabs" && /Flash/.test(r.model));
  const hasLite = BY_PATH.has("/text-to-speech/lite");
  const law = BENCHMARKS.find((b) => b.id === "eu-law");
  const lawUs = law?.rows.find((r) => r.ours);
  const lawThem = law?.rows.find((r) => !r.ours);
  const times = scribe ? Math.round(scribe.perHourUsd / us.longPerHour) : 0;
  const longTool = BY_PATH.get("/transcribe/long");
  const languages = longTool && /90\+ languages/.test(longTool.description) ? "More than 90 languages, detected or chosen." : "Many languages; set the language for the best result.";

  const title = `${brand}: speech to text, document and search APIs`;
  const description = `Transcribe an hour of audio for ${us.long}${hasLite ? `, text to speech from ${money(us.lite1k)} per 1,000 characters` : ""}, PDFs, documents and web pages to clean text, and search built for EU law and companies. One API key, a free try, failed calls never charged.`.slice(0, 300);

  // Hero code tabs: each runs a tool's own published example, so the request shown is one that works.
  const sample = (path: string) => {
    const e = BY_PATH.get(path);
    if (!e) return "";
    // ":" and "/" are legal in a query string; leaving them readable makes the example URL legible.
    const q = queryOf(e).replace(/%3A/gi, ":").replace(/%2F/gi, "/");
    return `<span class="k">curl</span> -H <span class="s">"Authorization: Bearer $GLYPHCALL_KEY"</span> \\\n  <span class="s">"${esc(origin)}${esc(e.path)}${q ? `?${esc(q)}` : ""}"</span>`;
  };
  const tabs: [label: string, path: string, out: string][] = [
    ["Transcribe", "/transcribe/long", `200 OK: transcript, SRT subtitles and word timings for up to an hour of audio. ${us.long}.`],
    ["PDF to text", "/pdf/text", `200 OK: the text of every page as JSON. ${BY_PATH.get("/pdf/text")?.price ?? ""} a call.`],
    ["EU law search", "/law/search", `200 OK: the exact articles, with act, article number, full text and EUR-Lex link.`],
  ].filter(([, p]) => BY_PATH.has(p)) as [string, string, string][];
  const bars = Array.from({ length: 34 }, (_, i) => `<i style="animation-delay:-${((i * 137) % 1400) / 1000}s"></i>`).join("");

  // The four headline numbers.
  const stats: [n: string, l: string, s: string][] = [
    [us.long, "for an hour of transcription", scribe ? `ElevenLabs Scribe: ${esc(scribe.price)} (<a href="${esc(scribe.source)}">their price list</a>, ${esc(VOICE_CHECKED)})` : "Up to 60 minutes in one call, with subtitles"],
    ...(hasLite && flash ? [[money(us.lite1k), "per 1,000 characters of speech", `ElevenLabs Flash: ${esc(flash.price.replace(" per 1,000 characters", ""))} (<a href="${esc(flash.source)}">their price list</a>)`] as [string, string, string]] : []),
    ...(lawUs && lawThem && law ? [[lawUs.cells[0].replace(/\s/g, ""), `EU law questions: ${law.columns[0].toLowerCase()}`, `Exa search: ${esc(lawThem.cells[0])} on the same questions (<a href="${BENCHMARKS_PATH}#eu-law">benchmark, ${esc(law.date)}</a>)`] as [string, string, string]] : []),
    ["$0", "for any call that fails", "Errors, bad input and outages are never charged"],
  ];

  // Products, shelf by shelf.
  const shelves = SHELVES.map((s) => {
    const rank = (p: Product) => (s.slugs.indexOf(p.slug) + 1) || 99;
    const items = PRODUCTS.filter((p) => shelfOf(p) === s).sort((a, b) => rank(a) - rank(b));
    if (!items.length) return "";
    return `<div class="shelf" id="${s.id}"><div class="shelf-head"><span class="badge">${icon(s.id)}</span><h3>${esc(s.title)}</h3></div><p>${esc(s.lead)}</p><div class="cards">${items.map((p) => productCard(p, cardReady)).join("")}</div></div>`;
  }).join("");

  // Transcription price per hour against each rival's own price list, cheapest bar = ours.
  const rows = [
    { name: brand, model: "Whisper large-v3-turbo, up to 60 min a call", per: us.longPerHour, price: `${us.long} per hour`, source: "", us: true },
    ...STT_RIVALS.map((r) => ({ name: r.name, model: r.model, per: r.perHourUsd, price: r.price, source: r.source, us: false })),
  ].sort((a, b) => a.per - b.per || (a.us ? -1 : 1));
  const maxPer = Math.max(...rows.map((r) => r.per));
  const sttRows = rows.map((r) => `<tr${r.us ? ` class="us"` : ""}><td>${r.us ? esc(r.name) : `<a href="${esc(r.source)}">${esc(r.name)}</a>`}</td><td>${esc(r.model)}</td><td>${esc(money(r.per))}</td><td><div class="bar"><span style="width:${Math.max(6, Math.round((r.per / maxPer) * 100))}%"></span></div></td></tr>`).join("");

  const lawDuel = lawUs && lawThem && law ? (() => {
    const n = (s: string) => Number(s.split("/")[0].trim());
    const d = (s: string) => Number(s.split("/")[1]?.trim() || 1);
    const pct = (s: string) => Math.round((n(s) / d(s)) * 100);
    return `<div class="panel"><h3>EU law: the right article, first</h3><p>${esc(String(d(lawUs.cells[0])))} real compliance questions across GDPR, the AI Act, DSA, NIS2, DORA and more. Questions and scripts are public, so anyone can re-run them.</p>
<div class="duel"><div class="us"><b>${esc(brand)}</b><b>${esc(lawUs.cells[0])}</b><div class="bar"><span style="width:${pct(lawUs.cells[0])}%;background:var(--grad)"></span></div></div><div><span>Exa search</span><span>${esc(lawThem.cells[0])}</span><div class="bar"><span style="width:${pct(lawThem.cells[0])}%"></span></div></div></div>
<a href="${BENCHMARKS_PATH}">All benchmarks, including where Exa wins &rarr;</a></div>`;
  })() : "";

  // Pricing: the monthly plans as cards, the packs as chips, the full table folded.
  const offers = productOffers(PRODUCTS[0], cardReady);
  const highlight = ["speech-to-text-api", "pdf-to-text-api", "web-page-to-markdown-api", "company-check-api"].map((slug) => PRODUCTS.find((p) => p.slug === slug)).filter(Boolean) as Product[];
  const planCards = offers.map((o, i) => ({ o, i })).filter(({ o }) => o.monthly).map(({ o, i }, k, all) => {
    const price = o.label.replace(/ a month$/, "");
    return `<div class="plan${k === all.length - 1 ? " best" : ""}">${k === all.length - 1 ? `<span class="ribbon">Best value</span>` : ""}<div class="p">${esc(price)}<small> / month</small></div><ul>${highlight.map((p) => `<li><b>${esc(productOffers(p, cardReady)[i]?.calls ?? "")}</b> ${esc(p.unit)}</li>`).join("")}<li>One key for every API, unused credits roll over</li></ul><a class="btn${k === all.length - 1 ? " primary" : ""}" href="${esc(o.url)}">Start for ${esc(price)}</a></div>`;
  }).join("");
  const packs = offers.filter((o) => !o.monthly);
  const pricing = offers.length ? `<div class="plans">${planCards}</div>
${packs.length ? `<p class="packs"><span>Or a one-off pack that never expires:</span>${packs.map((o) => `<a href="${esc(o.url)}">${esc(o.label.replace(/ once$/, ""))}</a>`).join("")}</p>` : ""}
<details><summary>What each plan buys, API by API</summary><div><div class="scroll"><table><tr><th>Plan</th>${PRODUCTS.map((p) => `<th>${esc(p.unit.charAt(0).toUpperCase() + p.unit.slice(1))}</th>`).join("")}</tr>
${offers.map((o, i) => `<tr><td><a href="${esc(o.url)}">${esc(o.label)}</a></td>${PRODUCTS.map((p) => `<td>${esc(productOffers(p, cardReady)[i]?.calls ?? "")}</td>`).join("")}</tr>`).join("\n")}
</table></div><p class="small">Each column is what that amount buys if you spend it all on that one API. <a href="${esc(PLAN_PORTAL_URL)}">Cancel a plan at any time</a>. Details: <a href="/credits">pricing</a>.</p></div></details>`
    : `<p><a href="/credits">Plans and packs</a></p>`;

  const faq = faqItems(brand, languages, rows[0]?.us === true);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${origin}/#org`, name: brand, url: `${origin}/`, logo: `${origin}/favicon.svg`, description },
      { "@type": "WebSite", "@id": `${origin}/#site`, name: brand, url: `${origin}/`, publisher: { "@id": `${origin}/#org` } },
      { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    ],
  };
  const first = PRODUCTS.find((p) => p.slug === "speech-to-text-api") ?? PRODUCTS[0];
  const cta = `<a class="btn primary" href="/${esc(first.slug)}">Try it free, no account</a><a class="btn" href="#pricing">See pricing</a>`;
  const sampleCurl = `curl -H "Authorization: Bearer $GLYPHCALL_KEY" \\\n  "${origin}${BY_PATH.get("/pdf/text") ? `/pdf/text?${queryOf(BY_PATH.get("/pdf/text")!)}` : "/docs"}"`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#07070c">
<link rel="canonical" href="${esc(origin)}/">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(brand)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(origin)}/"><meta property="og:image" content="${esc(origin)}/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate icon" href="/favicon.ico">
<script type="application/ld+json">${jsonLd(ld)}</script>
<style>${STYLE}</style></head><body>
<header class="nav"><div class="wrap"><div class="home"><a href="/" aria-hidden="true" tabindex="-1">${LOGO}</a><a class="brand" href="/">${esc(brand)}</a></div>
<nav aria-label="Main">${SHELVES.map((s) => `<a href="#${s.id}">${esc(s.kicker.split(" ")[0])}</a>`).join("")}<a href="#compare">Compare</a><a href="#pricing">Pricing</a><a href="/docs">Docs</a></nav>
<div class="nav-cta"><a class="btn sm" href="/docs">Docs</a><a class="btn sm primary" href="/credits">Get an API key</a></div></div></header>
<main>
<section class="hero"><div class="glow"></div><div class="grid-bg"></div><div class="wrap">
<div><a class="pill" href="${VOICE_SITE}/transcribe"><b>NEW</b> ${esc(brand)} Transcribe Pro: long recordings, any format &rarr;</a>
<h1>Voice, documents and search.<br><span class="gt">One key. Fair prices.</span></h1>
<p class="lede">Transcribe <strong>an hour of audio for ${esc(us.long)}</strong>. Turn PDFs, scans and web pages into clean text. Find the exact EU law article or company record. <strong>You only pay for calls that work.</strong></p>
<div class="ctas">${cta}</div>
<ul class="trust"><li>Free try on every API</li><li>No account to start</li><li>Failed calls cost $0</li><li>Cancel any time</li></ul></div>
<div class="term" aria-label="Example requests"><div class="wave" aria-hidden="true">${bars}</div>
<div class="tabs">${tabs.map(([label], i) => `<input type="radio" name="hero-tab" id="t${i + 1}"${i === 0 ? " checked" : ""}><label for="t${i + 1}">${esc(label)}</label>`).join("")}
<div class="panes" style="width:100%">${tabs.map(([, path, out], i) => `<div class="pane p${i + 1}"><pre><code>${sample(path)}</code></pre><p class="out">${esc(out)}</p></div>`).join("")}</div></div></div>
</div></section>

<section class="stats" aria-label="In numbers"><div class="wrap">${stats.map(([n, l, s]) => `<div class="stat"><div class="n gt">${esc(n)}</div><div class="l">${esc(l)}</div><div class="s">${s}</div></div>`).join("")}</div></section>

<section class="sec" id="products"><div class="wrap">
<span class="kicker">The APIs</span><h2>Small, focused APIs that each do one job well</h2>
<p class="sub">One request per job, JSON back, and a free try on every page. Pick one, or use them all with the same key.</p>
${shelves}
</div></section>

<section class="sec" id="compare"><div class="wrap">
<span class="kicker">Compare</span><h2>${scribe && times >= 2 ? `An hour of transcription: ${esc(us.long)} here, ${esc(money(scribe.perHourUsd))} at ElevenLabs` : "Priced against the big names, openly"}</h2>
<p class="sub">Every rival price below is copied from the rival's own pricing page on ${esc(VOICE_CHECKED)} and linked. Every benchmark has its questions and scripts in public.</p>
<div class="vs"><div class="table"><div class="scroll"><table><thead><tr><th>Speech to text</th><th>Model</th><th>Per hour</th><th></th></tr></thead><tbody>${sttRows}</tbody></table></div>
<p class="note">Pre-recorded audio, pay as you go. <a href="/compare/whisper-api-alternative">Full comparison</a> &middot; <a href="/compare/elevenlabs-alternative">vs ElevenLabs</a></p></div>
<div class="side">${lawDuel}<div class="panel honest"><h3>Where others are better</h3><p>OpenAI's tts-1 costs less per character than our cheapest voice, ElevenLabs has far more voices and languages, and Exa finds research papers better than we do. We would rather tell you than have you find out.</p></div></div></div>
</div></section>

<section class="sec" id="free"><div class="wrap">
<span class="kicker">Free tools</span><h2>Try it in your browser. Free, private, no sign-up.</h2>
<p class="sub">The free modes run on your own device, so your recording or book stays on your computer.</p>
<div class="free">
<div class="tool"><span class="tag">Free</span><h3>Transcribe audio and video</h3><p>Speech to text in your browser, with text and subtitles to download.</p><a class="btn sm" href="${VOICE_SITE}/transcribe">Open Transcribe &rarr;</a></div>
<div class="tool"><span class="tag">Free</span><h3>Text to speech</h3><p>Natural voices from your text, saved as WAV or MP3.</p><a class="btn sm" href="${VOICE_SITE}/text-to-speech">Open Text to speech &rarr;</a></div>
<div class="tool"><span class="tag">Free</span><h3>Audiobook and podcast studio</h3><p>Turn a PDF, EPUB or Word file into an audiobook, or a script into a two-voice podcast.</p><a class="btn sm" href="${STUDIO_SITE}/audiobook">Open Studio &rarr;</a></div>
</div></div></section>

<section class="sec" id="how"><div class="wrap">
<span class="kicker">How it works</span><h2>From zero to first answer in a minute</h2>
<ol class="steps">
<li><strong>Try it.</strong> Every product page has a form that runs the real thing on your own input, free.</li>
<li><strong>Get a key.</strong> Pick a monthly plan or a one-off pack and pay by card. No account to create: the key is shown right after payment.</li>
<li><strong>Call it.</strong> Send the key in a header. A call that fails costs nothing.</li>
</ol>
<pre class="code"><code>${esc(sampleCurl)}</code></pre>
</div></section>

<section class="sec" id="pricing"><div class="wrap">
<span class="kicker">Pricing</span><h2>Simple plans. One key for everything.</h2>
<p class="sub">Plans add credits every month and unused credits stay. Packs never expire. Every API here takes the same key.</p>
${pricing}
</div></section>

<section class="sec" id="faq"><div class="wrap">
<span class="kicker">Questions</span><h2>Good to know</h2>
<div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><div>${esc(a)}</div></details>`).join("")}</div>

<div class="agents">
<h2>For AI agents</h2>
<p>The same APIs, and the rest of a catalogue of ${ENDPOINTS.length} tools, are available to AI agents: an MCP server at <code>${esc(origin)}/mcp</code> (the first ${FREE_CALLS_PER_CALLER} successful calls are free) and pay-per-call over HTTP. <a href="/agents">Agent catalogue and payment details</a> · <a href="/tools">all tools</a> · <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">OpenAPI</a></p>
</div>
</div></section>

<section class="final"><h2>Ship the feature today, <span class="gt">not next quarter</span></h2><p>Free to try, no account, and you only pay for answers that come back.</p><div class="ctas">${cta}</div></section>
</main>
<footer><div class="wrap"><div class="cols">
<div><div class="home" style="margin-bottom:10px">${LOGO.replace(/gc-logo/g, "gc-logo-f")}<strong style="color:var(--fg)">${esc(brand)}</strong></div><p>Focused APIs for voice, documents and search. Pay only for calls that work.</p></div>
${SHELVES.map((s) => `<div><h4>${esc(s.kicker)}</h4><ul>${PRODUCTS.filter((p) => shelfOf(p) === s).map((p) => `<li><a href="/${esc(p.slug)}">${esc(p.name.replace(/ API( for .*)?$/, ""))}</a></li>`).join("")}</ul></div>`).join("")}
</div>
<p class="legal"><a href="/docs">Docs</a> · <a href="/credits">Pricing</a> · <a href="${BENCHMARKS_PATH}">Benchmarks</a> · <a href="/compare/elevenlabs-alternative">vs ElevenLabs</a> · <a href="/agents">For AI agents</a> · ${COMPANY_FOOTER}</p>
</div></footer></body></html>`;
}
