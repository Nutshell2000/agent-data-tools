// The installable Glyphcall app (17 Nov 2026): the free voice console as a full-screen app that installs from the
// browser on Windows, macOS, Linux, Android and iPhone and keeps working offline once its models have been fetched.
//
// Owner, 17 Nov 2026: "does elevenlabs have their own downloadable program? we need that also". Checked the same day:
// ElevenLabs has no desktop program of its own (ElevenReader is an iOS and Android reading app; "ElevenLabs desktop"
// downloads that turn up in search are third-party pages and wrappers). So the app here covers every platform at once.
// It is an installable web app on purpose, not a .exe or .dmg: nothing for antivirus to flag, no signing certificate to
// buy, no installer to trust, updates arrive with the site, and the visitor can remove it from their system settings.
//
// Pieces: GET /app (this page), /manifest.webmanifest, /sw.js (scope /app only; it caches the page shell and the
// model runtime so the app opens offline, while the model files themselves are cached by the Transformers.js runtime
// in the browser's Cache Storage after the first use).
import { CONSOLE_VOICES, VOICE_CONSOLE_CSS, VOICE_SITE, voiceConsole, voiceConsoleScript } from "./voice-console";

export const APP_PATH = "/app";
export const APP_VERSION = "1";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function appManifest(brand: string): Record<string, unknown> {
  return {
    name: `${brand} Voice`,
    short_name: brand,
    description: "Free text to speech and speech to text that run on your own device. No account, no limits, works offline.",
    id: APP_PATH,
    start_url: `${APP_PATH}?source=app`,
    scope: `${APP_PATH}`,
    display: "standalone",
    orientation: "any",
    background_color: "#07070c",
    theme_color: "#07070c",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Text to speech", url: `${APP_PATH}?tab=tts&source=shortcut` },
      { name: "Speech to text", url: `${APP_PATH}?tab=stt&source=shortcut` },
    ],
  };
}

/** The service worker. Cache-first for the shell, stale-while-revalidate for the model runtime on public CDNs. */
export function appServiceWorker(): string {
  return `const V="glyphcall-app-v${APP_VERSION}",SHELL=["${APP_PATH}","/logo.png","/favicon.svg"];
const CDN=/^https:\\/\\/(cdn\\.jsdelivr\\.net|cdnjs\\.cloudflare\\.com)\\//;
self.addEventListener("install",(e)=>{e.waitUntil(caches.open(V).then((c)=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",(e)=>{e.waitUntil(caches.keys().then((ks)=>Promise.all(ks.filter((k)=>k.startsWith("glyphcall-app-")&&k!==V).map((k)=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",(e)=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);
if(u.origin===location.origin&&(u.pathname==="${APP_PATH}"||SHELL.includes(u.pathname))){e.respondWith(caches.open(V).then(async(c)=>{const hit=await c.match(u.pathname==="${APP_PATH}"?"${APP_PATH}":r);const net=fetch(r).then((res)=>{if(res.ok)c.put(u.pathname==="${APP_PATH}"?"${APP_PATH}":r,res.clone());return res;}).catch(()=>hit);return hit||net;}));return;}
if(CDN.test(r.url)){e.respondWith(caches.open(V).then(async(c)=>{const hit=await c.match(r);const net=fetch(r).then((res)=>{if(res.ok)c.put(r,res.clone());return res;}).catch(()=>hit);return hit||net;}));}});`;
}

const STYLE = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#07070c;color:#f4f4fb;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;min-height:100vh}
a{color:#22d3ee}.wrap{max-width:860px;margin:0 auto;padding:0 16px}
header.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;max-width:860px;margin:0 auto}
header.bar .brand{display:flex;align-items:center;gap:10px;color:#f4f4fb;text-decoration:none;font-weight:750}header.bar img{width:30px;height:30px;border-radius:8px}
.btn{appearance:none;font:inherit;font-weight:650;font-size:.92rem;border:1px solid #25253a;background:none;color:#f4f4fb;padding:8px 14px;border-radius:10px;cursor:pointer;text-decoration:none}
.btn.primary{border:0;background:linear-gradient(100deg,#a78bfa,#22d3ee);color:#07070c}
h1{font-size:clamp(1.6rem,4vw,2.3rem);line-height:1.15;margin:8px 0 6px}p.lede{color:#a3a3bf;margin:0 0 18px}
.card{border:1px solid #25253a;border-radius:16px;background:#0e0e18;padding:16px;margin:20px 0}.card h2{margin:0 0 6px;font-size:1.05rem}.card p,.card li{color:#a3a3bf;font-size:.93rem}.card ul{margin:8px 0 0;padding-left:20px}
.offline{display:none;background:#1f2937;border:1px solid #374151;border-radius:12px;padding:10px 14px;margin:0 0 14px;font-size:.9rem}.offline.on{display:block}
footer{max-width:860px;margin:30px auto 40px;padding:0 16px;color:#a3a3bf;font-size:.85rem}`;

export function appPage(brand: string, origin: string): string {
  const voiceCount = CONSOLE_VOICES.length;
  const title = `${brand} Voice app: free text to speech and transcription, offline`;
  const description = `Install ${brand} Voice on Windows, Mac, Linux, Android or iPhone. ${voiceCount} natural voices and speech to text that run on your own device: no account, no limits, works offline.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(origin)}${APP_PATH}"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#07070c">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="${esc(brand)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(origin)}${APP_PATH}"><meta property="og:image" content="${esc(origin)}/og-glyphcall.png">
<style>${STYLE}\n${VOICE_CONSOLE_CSS}</style></head><body>
<header class="bar"><a class="brand" href="/"><img src="/logo.png" alt="" width="30" height="30">${esc(brand)} Voice</a><button type="button" class="btn primary" id="install" hidden>Install app</button></header>
<main class="wrap">
<h1>Your voice studio, on your own device.</h1>
<p class="lede">Text to speech in ${voiceCount} voices and transcription of any recording, free and unlimited. Nothing is uploaded and there is no account.</p>
<div class="offline" id="offline" role="status">You are offline. The app still works once its voice and listening models have been fetched on this device.</div>
${voiceConsole({ id: "app-vc", voiceSite: VOICE_SITE, first: "tts" })}
<div class="card" id="how"><h2>Install it like any app</h2>
<ul><li><strong>Windows, Mac, Linux (Chrome, Edge, Brave):</strong> press <em>Install app</em> above, or the install icon in the address bar. It gets its own window and a desktop or Start menu icon.</li>
<li><strong>Android:</strong> open this page in Chrome, menu, <em>Install app</em>.</li>
<li><strong>iPhone and iPad:</strong> in Safari press Share, then <em>Add to Home Screen</em>.</li></ul>
<p>It is a web app, so there is no installer file to trust and nothing for antivirus to flag. Updates arrive on their own, and you can remove it from your system's app list at any time. The first time you press Play the voice model (about 90 MB) is saved on your device; after that it works with no connection.</p></div>
<div class="card"><h2>Building it into your own app?</h2><p>The same voices and transcription run on our servers through an API at a price per hour. <a href="/text-to-speech-api">Text to speech API</a> &middot; <a href="/speech-to-text-api">Speech to text API</a> &middot; <a href="/docs">Docs</a></p></div>
</main>
<footer><a href="/">${esc(brand)}</a> &middot; <a href="/docs">Docs</a> &middot; <a href="/credits">Pricing</a></footer>
${voiceConsoleScript()}
<script>(()=>{"use strict";
const p=new URLSearchParams(location.search),t=p.get("tab");if(t==="stt"){const b=document.getElementById("app-vc-t-stt");if(b)b.click();}
const off=document.getElementById("offline"),upd=()=>off.classList.toggle("on",!navigator.onLine);addEventListener("online",upd);addEventListener("offline",upd);upd();
if("serviceWorker"in navigator)addEventListener("load",()=>{navigator.serviceWorker.register("/sw.js",{scope:"${APP_PATH}"}).catch(()=>{});});
let ev=null;const ib=document.getElementById("install");
addEventListener("beforeinstallprompt",(e)=>{e.preventDefault();ev=e;ib.hidden=false;});
ib.onclick=async()=>{if(!ev)return;ev.prompt();try{await ev.userChoice;}catch{}ev=null;ib.hidden=true;};
addEventListener("appinstalled",()=>{ib.hidden=true;});
})();</script></body></html>`;
}
