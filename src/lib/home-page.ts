// The front page of the product site (glyphcall.com), for people. Served at "/" only when the owner has set a public
// brand (PUBLIC_BRAND, lib/public-brand.ts); until then "/" stays the agent catalogue, which is always at /agents.
//
// Owner, 15 Nov 2026: "make our great homepage that beats ElevenLabs, Exa, everybody's homepages ... must draw in a lot
// of customers", and "no personal information, only market Glyphcall".
// Owner, 17 Nov 2026: "more like elevenlabs in layout (we still use our own cool dark graphics) ... way more user
// friendly and accessible to beginners, too much reading and instructions in people's faces in the beginning; we want
// to market to the masses as well". So the page is built for someone who has never heard of an API:
// - The top of the page is one short headline, one short line and the free tool. Nothing else to read.
// - Then "What do you want to make?": big tiles, one line each, every tile opens a free tool.
// - Then three steps, then a plain pricing block that says the browser tools are free.
// - Everything for developers (APIs, code, price comparisons, plans) sits below, under "For developers", folded where
//   it is long. No developer word (API, key, call, curl) above that section except the nav link to it.
//
// Rules for this page:
// - Every number is computed from the catalog, the plans or the console's voice list. Never type a number.
// - No rival names, prices or benchmarks (owner, 17 Nov 2026: "we are gonna just have the better products, people will
//   compare themselves"; the /compare and /benchmarks pages were removed in 1.216.2). Only the factual request-format
//   line ("OpenAI- and ElevenLabs-shaped requests work") stays: it says what the API accepts.
// - No payment protocol, wallet or crypto word before the "For AI agents" section (tests/site-pages.test.cjs).
// - The only script is the free voice console in the hero (lib/voice-console.ts). Everything else stays script-free:
//   the code tabs are radio inputs, the phone menu and the folded parts are <details>, the motion is CSS and stops under
//   prefers-reduced-motion.
import { ENDPOINTS, exampleParams, type Endpoint } from "../endpoints";
import { TOOL_COUNT } from "../endpoints";
import { CONSOLE_VOICES, STUDIO_SITE, VOICE_CONSOLE_CSS, VOICE_SITE, voiceConsole, voiceConsoleScript } from "./voice-console";
import { PLAN_PORTAL_URL } from "./credits";
import { firstCall } from "./first-call";
import { FREE_CALLS_PER_CALLER, FREE_HTTP_CALLS_PER_CALLER } from "./free-calls";
import { COMPANY_FOOTER } from "./legal";
import { PRODUCTS, productOffers, type Product } from "./product-pages";
import { ourVoice } from "./voice-prices";
import { webApplicationScript } from "./app-jsonld";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const BY_PATH = new Map(ENDPOINTS.map((e) => [e.path, e as Endpoint]));
const queryOf = (e: Endpoint) => exampleParams(e).map(([k, p]) => `${k}=${encodeURIComponent(String(p.example ?? ""))}`).join("&");
/** $0.05, $0.20, $0.258, $1.50: two decimals, a third only when it carries a digit. */
const money = (n: number) => `$${n.toFixed(3).replace(/(\.\d\d)0$/, "$1")}`;

export { VOICE_SITE, STUDIO_SITE };

/** Which group of the developer section each product sits in. A product not named here lands in the last group. */
const SHELVES: readonly { id: string; kicker: string; title: string; slugs: readonly string[] }[] = [
  { id: "voice", kicker: "Voice", title: "Voice", slugs: ["speech-to-text-api", "text-to-speech-api"] },
  { id: "documents", kicker: "Documents", title: "Documents", slugs: ["pdf-to-text-api", "document-to-text-api", "invoice-data-extraction-api", "web-page-to-markdown-api", "bulk-web-reader-api"] },
  { id: "search", kicker: "Search and checks", title: "Search and checks", slugs: ["eu-law-search-api", "company-check-api", "eu-sanctions-screening-api"] },
];

const ICON: Record<string, string> = {
  voice: `<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>`,
  documents: `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`,
  speaker: `<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>`,
  text: `<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>`,
  captions: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3"/>`,
  book: `<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>`,
  podcast: `<circle cx="12" cy="11" r="3"/><path d="M12 14v7M7.5 15.5a6 6 0 1 1 9 0"/>`,
  phone: `<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>`,
  check: `<path d="m5 12 5 5 9-10"/>`,
  lock: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  download: `<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>`,
};
const icon = (id: string) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[id] ?? ICON.search}</svg>`;

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="gc-logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#gc-logo)"/><g fill="#0a0a12"><rect x="7" y="13" width="3" height="6" rx="1.5"/><rect x="12" y="9" width="3" height="14" rx="1.5"/><rect x="17" y="5" width="3" height="22" rx="1.5"/><rect x="22" y="11" width="3" height="10" rx="1.5"/></g></svg>`;

const STYLE = `:root{color-scheme:dark;--bg:#07070c;--bg2:#0d0d16;--card:#11111c;--card2:#161624;--line:#25253a;--fg:#f4f4fb;--muted:#a3a3bf;--dim:#7b7b97;--v:#8b5cf6;--c:#22d3ee;--g:#34d399;--grad:linear-gradient(100deg,#a78bfa 0%,#22d3ee 100%)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:var(--c);text-decoration:none}a:hover{text-decoration:underline}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
:focus-visible{outline:2px solid var(--c);outline-offset:2px}
.wrap{max-width:1160px;margin:0 auto;padding:0 16px}
.glow{position:absolute;inset:-160px 0 auto 0;height:980px;pointer-events:none;background:radial-gradient(640px 380px at 22% 18%,rgba(139,92,246,.32),transparent 70%),radial-gradient(600px 360px at 78% 10%,rgba(34,211,238,.20),transparent 70%);z-index:0}
.grid-bg{position:absolute;inset:0;height:900px;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse at 50% 0,#000 30%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse at 50% 0,#000 30%,transparent 75%);z-index:0}
header.nav{position:sticky;top:0;z-index:20;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);background:rgba(7,7,12,.75);border-bottom:1px solid rgba(255,255,255,.06)}
header.nav .wrap{display:flex;align-items:center;gap:18px;height:64px}
.home{display:flex;align-items:center;gap:10px}.logo{width:30px;height:30px;flex:none}a.brand{color:var(--fg);font-weight:800;font-size:1.15rem;letter-spacing:-.01em}a.brand:hover{text-decoration:none}
header.nav nav{display:flex;gap:2px;margin-left:14px}header.nav nav a{color:var(--muted);padding:8px 12px;border-radius:999px;font-size:.95rem;white-space:nowrap}header.nav nav a:hover{color:var(--fg);background:rgba(255,255,255,.06);text-decoration:none}
.nav-cta{margin-left:auto;display:flex;gap:8px;align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 24px;border-radius:999px;font-weight:650;font-size:1rem;border:1px solid var(--line);color:var(--fg);background:rgba(255,255,255,.04);transition:transform .15s,border-color .15s,background .15s;white-space:nowrap}
.btn:hover{text-decoration:none;border-color:#3a3a58;background:rgba(255,255,255,.08);transform:translateY(-1px)}
.btn.primary{border:0;color:#07070c;background:var(--grad);box-shadow:0 8px 30px -8px rgba(139,92,246,.6)}.btn.primary:hover{filter:brightness(1.08)}
.btn.white{border:0;color:#07070c;background:#f4f4fb}.btn.white:hover{background:#fff}
.btn.sm{padding:9px 16px;font-size:.92rem}
section{position:relative;z-index:1}
.hero{padding:64px 0 28px;text-align:center}
.hero h1{font-size:clamp(2.3rem,6vw,4.4rem);line-height:1.03;letter-spacing:-.035em;margin:0 auto 16px;font-weight:850;max-width:22ch}
.gt{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lede{font-size:clamp(1.08rem,1.8vw,1.3rem);color:var(--muted);margin:0 auto 30px;max-width:40ch}
.hero .stage{max-width:900px;margin:0 auto;text-align:left}
.hero .vc{box-shadow:0 40px 100px -30px rgba(139,92,246,.45),0 0 0 1px rgba(255,255,255,.03) inset}
.hero .after{margin:16px 0 0;color:var(--dim);font-size:.95rem;text-align:center}
.stats{padding:20px 0 8px}.trust{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 28px;margin:0;padding:0;list-style:none;color:var(--muted);font-size:.98rem}
.trust li{display:flex;align-items:center;gap:8px}.trust .ico{width:18px;height:18px;color:var(--g)}
.ico{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.sec{padding:96px 0 0}.center{text-align:center}
h2{font-size:clamp(1.9rem,4vw,3rem);line-height:1.08;letter-spacing:-.03em;margin:0 0 12px;font-weight:820}
.center h2,.center .sub{margin-left:auto;margin-right:auto}
.sub{color:var(--muted);font-size:1.15rem;max-width:52ch;margin:0 0 36px}
.kicker{display:inline-block;color:var(--c);font-weight:700;font-size:.82rem;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.tile{position:relative;display:flex;flex-direction:column;gap:10px;padding:28px;border-radius:22px;border:1px solid var(--line);background:radial-gradient(420px 180px at 0 0,rgba(139,92,246,.12),transparent 65%),var(--card);color:var(--fg);transition:transform .18s,border-color .18s;min-height:190px}
.tile:hover{transform:translateY(-4px);border-color:#4a4a70;text-decoration:none}
.tile .badge{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:var(--grad);color:#07070c}
.tile .badge .ico{width:26px;height:26px;stroke-width:2}
.tile h3{margin:6px 0 0;font-size:1.3rem;letter-spacing:-.015em}.tile p{margin:0;color:var(--muted);font-size:1rem}
.tile .go{margin-top:auto;color:var(--c);font-weight:650;font-size:.95rem}
.tile .free{position:absolute;top:22px;right:22px;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--g);background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);padding:3px 9px;border-radius:999px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;counter-reset:s;list-style:none;padding:0;margin:0}
.steps li{counter-increment:s;padding:30px 26px;border-radius:22px;border:1px solid var(--line);background:var(--card);text-align:left}
.steps li::before{content:counter(s);display:grid;place-items:center;width:44px;height:44px;border-radius:14px;margin-bottom:16px;background:var(--grad);color:#07070c;font-weight:850;font-size:1.2rem}
.steps strong{display:block;color:var(--fg);font-size:1.2rem;margin-bottom:4px}.steps span{color:var(--muted)}
.freebox{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;padding:36px;border-radius:26px;border:1px solid transparent;background:linear-gradient(var(--card),var(--card)) padding-box,var(--grad) border-box;box-shadow:0 30px 80px -40px rgba(139,92,246,.7);text-align:left;margin:0 0 56px}
.freebox .p{font-size:3.4rem;font-weight:850;letter-spacing:-.04em;line-height:1}.freebox .p small{font-size:1.05rem;color:var(--muted);font-weight:500;letter-spacing:0}
.freebox ul{display:flex;flex-wrap:wrap;gap:8px 22px;list-style:none;padding:0;margin:16px 0 0;color:var(--muted)}.freebox li::before{content:"\\2713";color:var(--g);font-weight:800;margin-right:7px}
.freebox h3{margin:0 0 6px;font-size:1.35rem}
.devhead{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 14px;text-align:left}.devhead h3{margin:0;font-size:1.3rem}.devhead p{margin:0;color:var(--muted)}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:18px;text-align:left}
.plan{padding:26px;border-radius:20px;border:1px solid var(--line);background:var(--card)}
.plan.best{border-color:#4a4a70}
.plan .p{font-size:2.3rem;font-weight:850;letter-spacing:-.03em}.plan .p small{font-size:1rem;color:var(--muted);font-weight:500}
.plan ul{list-style:none;padding:0;margin:14px 0 18px;color:var(--muted);font-size:.94rem}.plan li{padding:5px 0;border-bottom:1px dashed #23233a}.plan li b{color:var(--fg)}
.plan .btn{width:100%}.ribbon{float:right;font-size:.75rem;font-weight:700;color:#07070c;background:var(--grad);padding:3px 9px;border-radius:999px}
.packs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--muted);font-size:.94rem;margin:0 0 14px}.packs a{padding:7px 13px;border-radius:999px;border:1px solid var(--line);color:var(--fg)}.packs a:hover{border-color:var(--c);text-decoration:none}
details{border:1px solid var(--line);border-radius:16px;background:var(--card);margin:0 0 10px;text-align:left}summary{cursor:pointer;padding:18px 20px;font-weight:650;list-style:none}summary::-webkit-details-marker{display:none}
summary::after{content:"+";float:right;color:var(--c);font-weight:800}details[open] summary::after{content:"\\2212"}
details>div{padding:0 20px 18px;color:var(--muted)}details .scroll{overflow-x:auto}
.small{color:var(--dim);font-size:.88rem}
.devbox{padding:40px;border-radius:28px;border:1px solid var(--line);background:radial-gradient(700px 260px at 100% 0,rgba(34,211,238,.10),transparent 60%),var(--bg2)}
.dev{display:grid;grid-template-columns:.85fr 1.15fr;gap:32px;align-items:center;margin-bottom:40px}
.dev ol{margin:0 0 24px;padding-left:20px;color:var(--muted)}.dev ol li{margin:0 0 8px}.dev ol b{color:var(--fg)}
.ctas{display:flex;flex-wrap:wrap;gap:10px}
.term{position:relative;border-radius:18px;background:linear-gradient(180deg,#141422,#0c0c15);border:1px solid var(--line);overflow:hidden}
.wave{display:flex;align-items:center;justify-content:center;gap:4px;height:70px;padding:0 18px;border-bottom:1px solid var(--line);background:radial-gradient(400px 80px at 50% 50%,rgba(139,92,246,.18),transparent)}
.wave i{display:block;width:4px;border-radius:4px;background:var(--grad);animation:wv 1.4s ease-in-out infinite;opacity:.9}
@keyframes wv{0%,100%{height:12%}50%{height:80%}}
.tabs{display:flex;gap:2px;padding:10px 10px 0;flex-wrap:wrap}.tabs input{position:absolute;opacity:0;pointer-events:none}
.tabs label{cursor:pointer;padding:8px 13px;border-radius:9px 9px 0 0;color:var(--dim);font-size:.86rem;font-weight:600}
.tabs label:hover{color:var(--fg)}
.panes{border-top:1px solid var(--line)}.pane{display:none}
#t1:checked~.panes .p1,#t2:checked~.panes .p2,#t3:checked~.panes .p3,#t4:checked~.panes .p4{display:block}
#t1:checked~label[for=t1],#t2:checked~label[for=t2],#t3:checked~label[for=t3],#t4:checked~label[for=t4]{color:var(--fg);background:rgba(255,255,255,.05);box-shadow:inset 0 -2px 0 var(--c)}
#t1:focus-visible~label[for=t1],#t2:focus-visible~label[for=t2],#t3:focus-visible~label[for=t3],#t4:focus-visible~label[for=t4]{outline:2px solid var(--c)}
.pane pre{margin:0;padding:18px 20px 8px;font-size:.84rem;line-height:1.7;color:#d6d6ea;white-space:pre-wrap;word-break:break-all}
.pane pre.res{padding-top:0;color:#a7f3d0}
.pane pre .k{color:#c4b5fd}.pane pre .s{color:#67e8f9}
.pane .out{margin:0 20px 18px;padding:10px 12px;border-radius:10px;background:rgba(52,211,153,.07);border:1px solid rgba(52,211,153,.25);color:#a7f3d0;font-size:.84rem}
.shelf{margin:0 0 26px;text-align:left}.shelf h3{display:flex;align-items:center;gap:10px;font-size:1.05rem;margin:0 0 12px;color:var(--muted);font-weight:650}.shelf h3 .ico{width:20px;height:20px;color:#c4b5fd}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.card{position:relative;display:flex;flex-direction:column;padding:20px;border-radius:16px;border:1px solid var(--line);background:var(--card);transition:transform .18s,border-color .18s}
.card:hover{transform:translateY(-3px);border-color:#3b3b5c}
.card h4{margin:0 0 6px;font-size:1.02rem}.card h4 a{color:var(--fg)}
.card p{color:var(--muted);margin:0 0 12px;font-size:.92rem;flex:1}.card .price{display:flex;justify-content:space-between;gap:10px;align-items:baseline;border-top:1px solid var(--line);padding-top:10px;font-size:.88rem}
.card p.from{flex:0;color:var(--dim);font-size:.84rem;margin:8px 0 0}
.card a.cover{position:absolute;inset:0;border-radius:16px}
.nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:4px 0 18px}
.num{padding:18px;border-radius:14px;border:1px solid var(--line);background:var(--bg2)}.num .n{font-size:1.9rem;font-weight:850;letter-spacing:-.03em;line-height:1.05}.num .l{color:var(--fg);font-weight:600;margin:6px 0 2px;font-size:.95rem}.num .s{color:var(--dim);font-size:.82rem}.num .s a{color:var(--muted);text-decoration:underline}
table{border-collapse:collapse;width:100%;font-size:.93rem;min-width:520px}
th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:middle}th{color:var(--dim);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em}
tr:last-child td{border-bottom:0}tr.us td{background:linear-gradient(90deg,rgba(139,92,246,.16),rgba(34,211,238,.06));font-weight:650;color:var(--fg)}
.bar{height:8px;border-radius:8px;background:#26263a;min-width:60px}.bar span{display:block;height:100%;border-radius:8px;background:#4b4b6a}tr.us .bar span{background:var(--grad)}
.faq{max-width:820px;margin:0 auto}
.agents{margin-top:56px;padding:24px;border-radius:18px;border:1px dashed #33334d;background:rgba(255,255,255,.015);text-align:left}.agents h2{font-size:1.3rem;margin:0 0 6px}.agents p{color:var(--muted);margin:0;font-size:.95rem}.agents p a{color:var(--fg);text-decoration:underline}
.final{margin:110px 0 0;padding:80px 16px;text-align:center;border-top:1px solid var(--line);background:radial-gradient(700px 320px at 50% 0,rgba(139,92,246,.26),transparent 70%)}
.final h2{margin:0 auto 12px;max-width:18ch}.final p{color:var(--muted);margin:0 auto 28px;max-width:40ch;font-size:1.15rem}.final .ctas{justify-content:center}
footer{border-top:1px solid var(--line);padding:40px 0 56px;color:var(--dim);font-size:.9rem}
footer .cols{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:24px;margin-bottom:26px}footer h3,footer h4{color:var(--fg);margin:0 0 10px;font-size:.92rem}
footer ul{list-style:none;padding:0;margin:0}footer li{padding:3px 0}footer a{color:var(--muted)}
.menu{display:none;position:relative}.menu summary{list-style:none;cursor:pointer;padding:9px 14px;border:1px solid var(--line);border-radius:999px;font-weight:650;font-size:.92rem;background:none}.menu summary::-webkit-details-marker{display:none}.menu summary::after{content:""}
.menu{border:0;background:none;margin:0}.menu div{position:absolute;right:0;top:48px;display:grid;min-width:230px;padding:8px;border-radius:16px;border:1px solid var(--line);background:#0d0d16;box-shadow:0 20px 50px rgba(0,0,0,.5)}.menu div a{color:var(--fg);padding:11px 12px;border-radius:10px}.menu div a:hover{background:rgba(255,255,255,.06);text-decoration:none}
${VOICE_CONSOLE_CSS}
@media (max-width:960px){header.nav nav{display:none}.menu{display:block}.tiles{grid-template-columns:1fr 1fr}.dev{grid-template-columns:1fr}.freebox{grid-template-columns:1fr}footer .cols{grid-template-columns:1fr 1fr}.devbox{padding:24px}}
@media (max-width:620px){body{font-size:16px}.hero{padding-top:36px}.tiles,.steps{grid-template-columns:1fr}.tile{min-height:0}.nav-cta .btn:not(.primary){display:none}.freebox{padding:24px}.freebox .p{font-size:2.6rem}.sec{padding-top:72px}.ctas .btn{flex:1 1 100%}.trust{justify-content:flex-start;padding:0 4px}}
@media (prefers-reduced-motion:reduce){.wave i{animation:none;height:45%}.card,.btn,.tile{transition:none}html{scroll-behavior:auto}}`;

const shelfOf = (p: Product) => SHELVES.find((s) => s.slugs.includes(p.slug)) ?? SHELVES[SHELVES.length - 1];

function productCard(p: Product, cardReady: boolean): string {
  const tool = BY_PATH.get(p.tool);
  const lead = productOffers(p, cardReady).find((o) => o.monthly);
  return `<article class="card"><h4><a href="/${esc(p.slug)}">${esc(p.name)}</a></h4><p>${esc(p.tagline)}</p>`
    + `<div class="price"><span>Pay as you go</span><b>${tool ? `${esc(tool.price)} a call` : "See pricing"}</b></div>`
    + `${lead ? `<p class="from">${esc(lead.label)}: ${esc(lead.calls)} ${esc(p.unit)}</p>` : ""}`
    + `<a class="cover" href="/${esc(p.slug)}" aria-label="${esc(p.name)}: code, free try and plans"></a></article>`;
}

/** The FAQ: plain questions first, the developer ones last. Every answer restates what the docs, the privacy page or the tool descriptions already say. */
function faqItems(brand: string, languages: string, browserVoices: number, apiVoices: number): [q: string, a: string][] {
  return [
    ["Is it really free?", `Yes. Making speech and transcripts on this page, on voice.glyphcall.com and in the ${brand} app is free, with no account and no limit. You only pay if you want a long recording transcribed on our servers with Transcribe Pro, or if you build ${brand} into your own app or website.`],
    ["Do I need to sign up?", `No. Type your text or drop your file and press the button. There is nothing to fill in.`],
    ["Are my files private?", `The free tools run on your own device, so your text and recordings are never uploaded. The first time you press Play, your browser downloads the voice once; after that it starts in seconds.`],
    ["Which languages does it understand?", `${languages} Subtitles come back as SRT or VTT files you can add to any video.`],
    ["How many voices are there?", `${browserVoices} voices in the free browser tools and ${apiVoices} through the API. Both are our own voices; nothing is uploaded to make either one speak.`],
    ["Can I use it on my phone?", `Yes. Open this page on your phone, or install the free ${brand} app from glyphcall.com/app. It works on Windows, Mac, Linux, Android and iPhone, and keeps working offline.`],
    ["What happens when an API call fails?", `You pay nothing. Wrong input, a page that cannot be read or an outside source that is down are all free; only answers that succeed use credits.`],
    ["Can I cancel a plan?", `Any time, from the plan portal, with the e-mail address you paid with. Unused credits stay on your key and one-off packs never expire.`],
  ];
}

/**
 * The front page of the product site. `cardReady`: card plans and packs can be bought (lib/credit-routes.ts).
 * `opts.trial`: free calls are on, so the developer tabs open with a request that needs no key (lib/first-call.ts);
 * `opts.freeKey`: free keys by e-mail are offered (lib/free-keys.ts `freeKeysOn`), so the page links /keys/free.
 */
export function landingPage(brand: string, origin: string, cardReady: boolean, opts: { trial?: boolean; freeKey?: boolean } = {}): string {
  const us = ourVoice();
  const hasLite = BY_PATH.has("/text-to-speech/lite");
  const longTool = BY_PATH.get("/transcribe/long");
  const languages = longTool && /90\+ languages/.test(longTool.description) ? "More than 90 languages, detected by itself or chosen by you." : "Many languages; choose yours for the best result.";
  const voices = CONSOLE_VOICES.length;

  const title = `${brand}: free text to speech and transcription, plus voice and document APIs`;
  const description = `Turn text into natural speech and recordings into text, free in your browser with no sign-up. For apps: an hour of transcription for ${us.long}${hasLite ? `, speech from ${money(us.lite1k)} per 1,000 characters` : ""}, PDFs and web pages to text, and EU search. Failed calls are never charged.`.slice(0, 300);

  // Developer code tabs: each runs a tool's own published example, so the request shown is one that works.
  const sample = (path: string) => {
    const e = BY_PATH.get(path);
    if (!e) return "";
    // ":" and "/" are legal in a query string; leaving them readable makes the example URL legible.
    const q = queryOf(e).replace(/%3A/gi, ":").replace(/%2F/gi, "/");
    return `<span class="k">curl</span> -H <span class="s">"Authorization: Bearer $GLYPHCALL_KEY"</span> \\\n  <span class="s">"${esc(origin)}${esc(e.path)}${q ? `?${esc(q)}` : ""}"</span>`;
  };
  // The first tab needs no key: the request is a tool's published example with trial=1 and the answer under it is that
  // tool's published example answer (tests/first-call.test.cjs runs the printed URL and compares the two).
  const keyless = opts.trial ? firstCall(origin) : null;
  const tabs: [label: string, code: string, out: string][] = [
    ...(keyless ? [["Try it now", `<pre><code><span class="k">curl</span> <span class="s">"${esc(keyless.url)}"</span></code></pre><pre class="res"><code>${esc(keyless.output)}</code></pre>`, `That is the real answer, and the request needs no key: ${FREE_HTTP_CALLS_PER_CALLER} free calls per caller on most tools. After that, one key runs everything.`] as [string, string, string]] : []),
    ...([
      ["Transcribe", "/transcribe/long", `200 OK: transcript, SRT subtitles and word timings for up to an hour of audio. ${us.long}.`],
      ["PDF to text", "/pdf/text", `200 OK: the text of every page as JSON. ${BY_PATH.get("/pdf/text")?.price ?? ""} a call.`],
      ["EU law search", "/law/search", `200 OK: the exact articles, with act, article number, full text and EUR-Lex link.`],
    ].filter(([, p]) => BY_PATH.has(p)).map(([label, path, out]) => [label, `<pre><code>${sample(path)}</code></pre>`, out] as [string, string, string])),
  ];
  const bars = Array.from({ length: 34 }, (_, i) => `<i style="animation-delay:-${((i * 137) % 1400) / 1000}s"></i>`).join("");

  // The API prices in three numbers, for developers.
  const stats: [n: string, l: string, s: string][] = [
    [us.long, "for an hour of transcription", "Up to 60 minutes in one call, with subtitles and word timings"],
    ...(hasLite ? [[money(us.lite1k), "per 1,000 characters of speech", "Natural voices back as MP3, no credit pool to convert"] as [string, string, string]] : []),
    ["$0", "for any call that fails", "Errors, bad input and outages are never charged"],
  ];

  // Products, group by group.
  const shelves = SHELVES.map((s) => {
    const rank = (p: Product) => (s.slugs.indexOf(p.slug) + 1) || 99;
    const items = PRODUCTS.filter((p) => shelfOf(p) === s).sort((a, b) => rank(a) - rank(b));
    if (!items.length) return "";
    return `<div class="shelf" id="${s.id}"><h3>${icon(s.id)}${esc(s.title)}</h3><div class="cards">${items.map((p) => productCard(p, cardReady)).join("")}</div></div>`;
  }).join("");

  // Pricing: the free tools first, then the monthly plans as cards, the packs as chips, the full table folded.
  const offers = productOffers(PRODUCTS[0], cardReady);
  const highlight = ["speech-to-text-api", "pdf-to-text-api", "web-page-to-markdown-api", "company-check-api"].map((slug) => PRODUCTS.find((p) => p.slug === slug)).filter(Boolean) as Product[];
  const planCards = offers.map((o, i) => ({ o, i })).filter(({ o }) => o.monthly).map(({ o, i }, k, all) => {
    const price = o.label.replace(/ a month$/, "");
    return `<div class="plan${k === all.length - 1 ? " best" : ""}">${k === all.length - 1 ? `<span class="ribbon">Best value</span>` : ""}<div class="p">${esc(price)}<small> / month</small></div><ul>${highlight.map((p) => `<li><b>${esc(productOffers(p, cardReady)[i]?.calls ?? "")}</b> ${esc(p.unit)}</li>`).join("")}<li>One key for every API, unused credits roll over</li></ul><a class="btn${k === all.length - 1 ? " primary" : ""}" href="${esc(o.url)}">Start for ${esc(price)}</a></div>`;
  }).join("");
  const packs = offers.filter((o) => !o.monthly);
  const pricing = offers.length ? `<div class="devhead"><h3>For your own app or website</h3><p>Plans add credits every month and unused credits stay.</p></div><div class="plans">${planCards}</div>
${packs.length ? `<p class="packs"><span>Or a one-off pack that never expires:</span>${packs.map((o) => `<a href="${esc(o.url)}">${esc(o.label.replace(/ once$/, ""))}</a>`).join("")}</p>` : ""}
<details><summary>What each plan buys, API by API</summary><div><div class="scroll"><table><tr><th>Plan</th>${PRODUCTS.map((p) => `<th>${esc(p.unit.charAt(0).toUpperCase() + p.unit.slice(1))}</th>`).join("")}</tr>
${offers.map((o, i) => `<tr><td><a href="${esc(o.url)}">${esc(o.label)}</a></td>${PRODUCTS.map((p) => `<td>${esc(productOffers(p, cardReady)[i]?.calls ?? "")}</td>`).join("")}</tr>`).join("\n")}
</table></div><p class="small">Each column is what that amount buys if you spend it all on that one API. <a href="${esc(PLAN_PORTAL_URL)}">Cancel a plan at any time</a>. Details: <a href="/credits">pricing</a>.</p></div></details>`
    : `<p><a href="/credits">Plans and packs</a></p>`;

  const ttsTagline = PRODUCTS.find((p) => p.slug === "text-to-speech-api")?.tagline ?? "";
  const apiVoices = Number(/(\d+) natural voices/.exec(ttsTagline)?.[1] ?? CONSOLE_VOICES.length);
  const faq = faqItems(brand, languages, CONSOLE_VOICES.length, apiVoices);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${origin}/#org`, name: brand, url: `${origin}/`, logo: `${origin}/favicon.svg`, description },
      { "@type": "WebSite", "@id": `${origin}/#site`, name: brand, url: `${origin}/`, publisher: { "@id": `${origin}/#org` } },
      { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    ],
  };

  // What people come to make. Every tile opens a free tool; one line each, no jargon.
  const tiles: [ico: string, title: string, line: string, href: string, go: string][] = [
    ["speaker", "Voiceovers", "Type your text, pick a voice, download the audio.", "#try", "Make a voiceover"],
    ["text", "Transcripts", "Drop a recording and get every word back as text.", `${VOICE_SITE}/transcribe`, "Transcribe a file"],
    ["captions", "Subtitles", "Subtitle files for your videos, ready for YouTube.", `${VOICE_SITE}/transcribe`, "Make subtitles"],
    ["book", "Audiobooks", "Turn a PDF, EPUB or Word file into an audiobook.", `${STUDIO_SITE}/audiobook`, "Open the studio"],
    ["podcast", "Podcasts", "Write a script and hear it as a two-voice show.", `${STUDIO_SITE}/dialogue`, "Make a podcast"],
    ["phone", "The app", "Install it on your phone or computer. Works offline.", "/app", `Get the ${brand} app`],
  ];

  const navLinks = `<a href="#try">Text to speech</a><a href="${VOICE_SITE}/transcribe">Transcribe</a><a href="${STUDIO_SITE}/audiobook">Audiobooks</a><a href="#pricing">Pricing</a><a href="#developers">Developers</a>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#07070c">
<link rel="canonical" href="${esc(origin)}/">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(brand)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(origin)}/"><meta property="og:image" content="${esc(origin)}/og-glyphcall.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate icon" href="/favicon.ico">
<script type="application/ld+json">${jsonLd(ld)}</script>
${webApplicationScript({ name: brand, url: `${origin}/`, description, brand, offers: offers.map((o) => ({ label: o.label })) })}
<style>${STYLE}</style></head><body>
<header class="nav"><div class="wrap"><div class="home"><a href="/" aria-hidden="true" tabindex="-1">${LOGO}</a><a class="brand" href="/">${esc(brand)}</a></div>
<nav aria-label="Main">${navLinks}</nav>
<div class="nav-cta"><a class="btn sm" href="/app">Get the app</a><a class="btn sm primary" href="#try">Try it free</a><details class="menu"><summary aria-label="Menu">Menu</summary><div>${navLinks}<a href="/app">Get the app</a><a href="/docs">Docs</a>${opts.freeKey ? `<a href="/keys/free">Get a free key</a>` : ""}<a href="/credits">Get an API key</a></div></details></div></div></header>
<main>
<section class="hero" id="try"><div class="glow"></div><div class="grid-bg"></div><div class="wrap">
<h1>Make any text talk.<br><span class="gt">Turn voice into text.</span></h1>
<p class="lede">Free, right here in your browser. No sign-up, nothing to install.</p>
<div class="stage">${voiceConsole({ id: "hero-vc", voiceSite: VOICE_SITE, upsellTts: `Want it inside your own app? See <a href="#developers">${esc(brand)} for developers</a>.`, upsellStt: `Long recording? <a href="/transcribe-pro">Transcribe Pro</a> does up to an hour for you.` })}
<p class="after">Rather use an app? <a href="/app">Install ${esc(brand)} Voice</a>, free on your phone or computer.</p></div>
</div></section>

<section class="stats" aria-label="Why people like it"><div class="wrap"><ul class="trust">
<li>${icon("check")}Free, no limits</li><li>${icon("user")}No account needed</li><li>${icon("lock")}Your files stay on your device</li><li>${icon("download")}Download MP3, WAV or subtitles</li><li>${icon("speaker")}${voices} free browser voices</li>
</ul></div></section>

<section class="sec center" id="make"><div class="wrap">
<h2>What do you want to make?</h2>
<p class="sub">Pick one and start. Every one of these is free.</p>
<div class="tiles">${tiles.map(([ic, t, line, href, go]) => `<a class="tile" href="${esc(href)}"><span class="free">Free</span><span class="badge">${icon(ic)}</span><h3>${esc(t)}</h3><p>${esc(line)}</p><span class="go">${esc(go)} &rarr;</span></a>`).join("")}</div>
</div></section>

<section class="sec center"><div class="wrap"><p class="sub">Long recording, or want it done on our servers instead of your device? <a href="/transcribe-pro">Transcribe Pro</a> handles any length with subtitles.</p></div></section>

<section class="sec center" id="how"><div class="wrap">
<h2>As easy as 1, 2, 3</h2>
<p class="sub">No learning curve. If you can type, you can use ${esc(brand)}.</p>
<ol class="steps">
<li><strong>Type or drop</strong><span>Write some text, or drop in a recording.</span></li>
<li><strong>Pick a voice</strong><span>Choose from ${voices} voices and set the speed.</span></li>
<li><strong>Press Play</strong><span>Listen, then download it. Done.</span></li>
</ol>
<div class="ctas" style="justify-content:center;margin-top:30px"><a class="btn primary" href="#try">Start now, it&rsquo;s free</a></div>
</div></section>

<section class="sec center" id="pricing"><div class="wrap">
<h2>Free for everyone</h2>
<p class="sub">Everything you make on this page and in the app is free, on your own device. You only pay if you want a long recording done on our servers with <a href="/transcribe-pro">Transcribe Pro</a>, or if you build ${esc(brand)} into your own app or website.</p>
<div class="freebox"><div><h3>${esc(brand)} Free</h3><div class="p">$0<small> forever</small></div><ul><li>Text to speech</li><li>Transcripts and subtitles</li><li>All ${voices} browser voices</li><li>Every download</li><li>No account, no limits</li></ul></div><a class="btn white" href="#try">Start for free</a></div>
${pricing}
</div></section>

<section class="sec" id="developers"><div class="wrap"><div class="devbox">
<span class="kicker">For developers</span><h2>Building an app? One key does it all.</h2>
<p class="sub">The same voices and transcripts, plus document reading and search, as simple web requests. A free try on every page, and failed calls cost nothing.</p>
<div class="dev"><div><ol>
<li><b>Try it.</b> Every product page runs the real thing on your own input, free.</li>
<li><b>Get a key.</b> Pay by card; the key is shown right after payment. No account to create.</li>
<li><b>Call it.</b> OpenAI- and ElevenLabs-shaped requests work as they are.</li>
</ol>
<div class="ctas"><a class="btn primary" href="/credits">Get an API key</a>${opts.freeKey ? `<a class="btn" href="/keys/free">Get a free key</a>` : ""}<a class="btn" href="/docs">Read the docs</a></div></div>
<div class="term" aria-label="Example requests"><div class="wave" aria-hidden="true">${bars}</div>
<div class="tabs">${tabs.map(([label], i) => `<input type="radio" name="hero-tab" id="t${i + 1}"${i === 0 ? " checked" : ""}><label for="t${i + 1}">${esc(label)}</label>`).join("")}
<div class="panes" style="width:100%">${tabs.map(([, code, out], i) => `<div class="pane p${i + 1}">${code}<p class="out">${esc(out)}</p></div>`).join("")}</div></div></div></div>
<div class="nums">${stats.map(([n, l, s]) => `<div class="num"><div class="n gt">${esc(n)}</div><div class="l">${esc(l)}</div><div class="s">${esc(s)}</div></div>`).join("")}</div>
<div id="products">${shelves}</div>
</div></div></section>

<section class="sec" id="faq"><div class="wrap">
<div class="center"><h2>Questions</h2></div>
<div class="faq" style="margin-top:28px">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><div>${esc(a)}</div></details>`).join("")}

<div class="agents">
<h2>For AI agents</h2>
<p>The same APIs, and the rest of a catalogue of ${TOOL_COUNT} tools, are available to AI agents: an MCP server at <code>${esc(origin)}/mcp</code> (the first ${FREE_CALLS_PER_CALLER} successful calls are free) and pay-per-call over HTTP. <a href="/agents">Agent catalogue and payment details</a> · <a href="/tools">all tools</a> · <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">OpenAPI</a></p>
</div>
</div></div></section>

<section class="final"><h2>Give it a try. <span class="gt">It takes ten seconds.</span></h2><p>Free, no account, and nothing to install.</p><div class="ctas"><a class="btn primary" href="#try">Try it free, no account</a><a class="btn" href="/app">Get the app</a></div></section>
</main>${voiceConsoleScript()}
<footer><div class="wrap"><div class="cols">
<div><div class="home" style="margin-bottom:10px">${LOGO.replace(/gc-logo/g, "gc-logo-f")}<strong style="color:var(--fg)">${esc(brand)}</strong></div><p>Free text to speech and transcription in your browser, and simple APIs for voice, documents and search.</p><p><a href="${VOICE_SITE}/text-to-speech">Text to speech</a> · <a href="${VOICE_SITE}/transcribe">Transcribe</a> · <a href="${STUDIO_SITE}/audiobook">Audiobook studio</a> · <a href="/app">App</a></p></div>
${SHELVES.map((s) => `<div><h3>${esc(s.kicker)} APIs</h3><ul>${PRODUCTS.filter((p) => shelfOf(p) === s).map((p) => `<li><a href="/${esc(p.slug)}">${esc(p.name.replace(/ API( for .*)?$/, ""))}</a></li>`).join("")}</ul></div>`).join("")}
</div>
<p class="legal"><a href="/docs">Docs</a> · <a href="/credits">Pricing</a> · <a href="/transcribe-pro">Transcribe Pro</a> · <a href="/agents">For AI agents</a> · ${COMPANY_FOOTER}</p>
</div></footer></body></html>`;
}
