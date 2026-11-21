// The look of the product site, shared by its pages (21 Nov 2026). It lived inside lib/home-page.ts, so the page that
// sells Pro could not use it without importing the whole catalogue, and was plain unstyled text beside the front page.
// Strings only: this file imports nothing but the voice console's own styles.
import { VOICE_CONSOLE_CSS } from "./voice-console";

export const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="gc-logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#gc-logo)"/><g fill="#0a0a12"><rect x="7" y="13" width="3" height="6" rx="1.5"/><rect x="12" y="9" width="3" height="14" rx="1.5"/><rect x="17" y="5" width="3" height="22" rx="1.5"/><rect x="22" y="11" width="3" height="10" rx="1.5"/></g></svg>`;

export const STYLE = `:root{color-scheme:dark;--bg:#07070c;--bg2:#0d0d16;--card:#11111c;--card2:#161624;--line:#25253a;--fg:#f4f4fb;--muted:#a3a3bf;--dim:#7b7b97;--v:#8b5cf6;--c:#22d3ee;--g:#34d399;--grad:linear-gradient(100deg,#a78bfa 0%,#22d3ee 100%)}
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

/** The plan cards, the Free-and-Pro table and the Pro band (lib/voice-pro.ts `offerLadder`, `offerCompare`). */
export const OFFER_CSS = `.ladder{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:left;margin:0 0 22px}.tier{position:relative;display:flex;flex-direction:column;padding:30px 26px;border-radius:24px;border:1px solid var(--line);background:var(--card)}.tier.hot{border:1px solid transparent;background:linear-gradient(var(--card2),var(--card2)) padding-box,var(--grad) border-box;box-shadow:0 20px 60px -30px rgba(139,92,246,.7)}.tier h3{margin:0 0 4px;font-size:1.25rem}.tier .for{color:var(--muted);font-size:.95rem;margin:0 0 16px;min-height:2.9em}.tier .p{font-size:2.6rem;font-weight:850;letter-spacing:-.03em;line-height:1}.tier .p small{font-size:1rem;color:var(--muted);font-weight:500}.tier ul{list-style:none;padding:0;margin:18px 0 22px;color:var(--muted);font-size:.96rem;flex:1}.tier li{padding:6px 0 6px 26px;position:relative}.tier li::before{content:"";position:absolute;left:2px;top:13px;width:11px;height:6px;border-left:2px solid var(--c);border-bottom:2px solid var(--c);transform:rotate(-45deg)}.tier li b{color:var(--fg)}.tier .btn{width:100%}.tier .tag{position:absolute;top:-12px;left:26px;font-size:.75rem;font-weight:750;color:#07070c;background:var(--grad);padding:4px 11px;border-radius:999px}.tier .fine{margin:12px 0 0;font-size:.85rem;color:var(--dim);text-align:center}.tier .fine a{color:var(--muted);text-decoration:underline}.cmp{width:100%;border-collapse:collapse;text-align:left;font-size:.96rem;margin:24px 0 0}.cmp th,.cmp td{padding:13px 14px;border-bottom:1px solid var(--line);vertical-align:top}.cmp th{color:var(--fg);font-weight:700}.cmp td:first-child{color:var(--muted);width:28%}.cmp td{color:var(--muted)}.cmp td.yes{color:var(--fg)}.proband{display:grid;grid-template-columns:1.15fr 1fr;gap:30px;align-items:center;text-align:left;padding:40px;border-radius:28px;border:1px solid var(--line);background:radial-gradient(600px 260px at 100% 0,rgba(34,211,238,.12),transparent 65%),radial-gradient(520px 240px at 0 100%,rgba(139,92,246,.16),transparent 65%),var(--card)}.proband h2{font-size:clamp(1.6rem,3.2vw,2.3rem)}.proband .sub{margin:0 0 22px;max-width:none;font-size:1.05rem}.proband ul{list-style:none;padding:0;margin:0;display:grid;gap:12px}.proband li{padding:14px 16px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.03)}.proband li b{display:block;color:var(--fg)}.proband li span{color:var(--muted);font-size:.94rem}.hero .kicker{margin-bottom:14px}.stickbar{display:none}footer .legal a{white-space:nowrap}@media (max-width:720px){.stickbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;gap:10px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(7,7,12,.94);backdrop-filter:blur(10px);border-top:1px solid var(--line)}.stickbar .btn{flex:1;padding:12px 10px;font-size:.98rem}body.has-stickbar{padding-bottom:76px}footer li a,footer .legal a,footer p a{display:inline-block;padding:12px 0}}@media (max-width:960px){.ladder{grid-template-columns:1fr}.proband{grid-template-columns:1fr;padding:26px}.tier .for{min-height:0}.cmp td:first-child{width:auto}}`;
