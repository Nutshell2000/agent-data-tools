// Studio voices on the front page (21 Nov 2026): the first place where a visitor can USE a paid voice feature.
//
// The free console (lib/voice-console.ts) makes speech on the visitor's own device, after a 90 MB download, with 21
// English voices. The paid speech API has had 50 server-made voices in English and Spanish all along, but only for
// people who write code. This block puts them under the console: pick a studio voice, press play, and the text in the
// console is spoken by POST /v1/audio/speech and comes back as an MP3 at once.
//
// What a visitor needs is a paid key: a Pro key (the monthly plan) or any prepaid key. Speech costs credits per 100
// characters, up to 2,000 characters a call. There is no free way in (21 Nov 2026, the owner: a free user must cost
// nothing metered, and every studio voice is a speech model call): the free-try button and the free test key it
// asked for are gone from this block. The key is kept in the browser's local storage on this device only, and nothing
// is promised that the speech endpoint does not do.
//
// This file is strings only (no catalogue import): the voice names and numbers are passed in by the page.

export interface StudioVoicesOptions {
  /** The id of the textarea whose text is spoken (the console's). */
  textId: string;
  /** Voice names by language, as the speech tools list them. */
  voices: { en: readonly string[]; es: readonly string[] };
  /** Where the plan is bought, and what it costs ("$3"). */
  planUrl: string;
  planPrice: string;
  /** Characters of studio speech a month of the plan buys. */
  planCharacters: number;
  /** Longest text one call speaks. */
  maxCharacters: number;
  /** Not used any more (the block takes a paid key only); still accepted so the pages that pass them need no change. */
  testCharacters?: number;
  freeTry?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const STUDIO_VOICES_CSS = `.sv{margin:18px auto 0;max-width:860px;text-align:left;padding:22px;border-radius:20px;border:1px solid var(--line);background:radial-gradient(520px 200px at 100% 0,rgba(34,211,238,.10),transparent 65%),var(--card)}.sv h2{font-size:1.15rem;margin:0 0 4px;letter-spacing:0}.sv .pro{display:inline-block;margin-left:8px;font-size:.72rem;font-weight:750;color:#07070c;background:var(--grad);padding:2px 9px;border-radius:999px;vertical-align:middle}.sv p{margin:0 0 14px;color:var(--muted);font-size:.95rem}.sv-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.sv select,.sv input{font:inherit;color:var(--fg);background:#0b0b13;border:1px solid var(--line);border-radius:12px;padding:11px 12px;min-width:0}.sv select{flex:1 1 180px}.sv input{flex:2 1 220px}.sv button{font:inherit;font-weight:650;cursor:pointer;border-radius:999px;padding:11px 20px;border:1px solid var(--line);color:var(--fg);background:rgba(255,255,255,.04)}.sv button.go{border:0;color:#07070c;background:var(--grad)}.sv button:disabled{opacity:.55;cursor:default}.sv audio{width:100%;margin-top:14px}.sv .msg{margin:12px 0 0;font-size:.92rem;color:var(--muted);min-height:1.3em}.sv .msg.err{color:#fca5a5}.sv .key{margin-top:12px}.sv .key summary{cursor:pointer;color:var(--muted);font-size:.92rem}.sv .key .sv-row{margin-top:10px}.sv a{color:var(--c)}`;

/** The block's markup. Works without the script as a plain description with a link to the plan. */
export function studioVoices(o: StudioVoicesOptions): string {
  const group = (label: string, lang: string, names: readonly string[]) => names.length ? `<optgroup label="${esc(label)}">${names.map((n) => `<option value="${esc(lang)}:${esc(n)}"${lang === "en" && n === "luna" ? " selected" : ""}>${esc(cap(n))}</option>`).join("")}</optgroup>` : "";
  const total = o.voices.en.length + o.voices.es.length;
  return `<div class="sv" id="sv" data-text="${esc(o.textId)}" data-max="${o.maxCharacters}">
<h2>Studio voices<span class="pro">Pro</span></h2>
<p>${total} voices made on our servers, in English and Spanish. No download: the audio is made for you, so it works the same on any phone or computer. They read the text in the box above, up to ${o.maxCharacters.toLocaleString("en-US")} characters at a time.</p>
<div class="sv-row"><label class="sr" for="sv-voice" style="position:absolute;left:-9999px">Studio voice</label><select id="sv-voice">${group("English", "en", o.voices.en)}${group("Spanish", "es", o.voices.es)}</select>
<button type="button" class="go" id="sv-play" data-ev="studio_play">&#9654; Play with a studio voice</button></div>
<audio id="sv-audio" controls hidden></audio>
<p class="msg" id="sv-msg" role="status" aria-live="polite">Studio voices need a paid key. With <a href="${esc(o.planUrl)}">a Pro key (${esc(o.planPrice)} a month)</a> you get about ${o.planCharacters.toLocaleString("en-US")} characters of studio speech every month.</p>
<details class="key"><summary>I have a key</summary><div class="sv-row"><label class="sr" for="sv-key" style="position:absolute;left:-9999px">Your key</label><input id="sv-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your key (it starts with adt_)"><button type="button" id="sv-save">Use this key</button><button type="button" id="sv-forget" hidden>Forget the key</button></div></details>
<noscript><p>Studio voices need JavaScript. <a href="${esc(o.planUrl)}">Get a Pro key</a> or use the <a href="/text-to-speech-api">speech API</a>.</p></noscript>
</div>`;
}

/** The block's behaviour. Kept apart from the console's script: it only reads the console's text box. */
export function studioVoicesScript(): string {
  return `<script data-gc-studio>(function(){var b=document.getElementById("sv");if(!b)return;
var $=function(i){return document.getElementById(i)},msg=$("sv-msg"),play=$("sv-play"),audio=$("sv-audio"),voice=$("sv-voice"),keyIn=$("sv-key"),save=$("sv-save"),forget=$("sv-forget");
var MAX=Number(b.dataset.max)||2000,K="gc-studio-key",url=null;
var store={get:function(){try{return localStorage.getItem(K)||""}catch(e){return ""}},set:function(v){try{if(v)localStorage.setItem(K,v);else localStorage.removeItem(K)}catch(e){}}};
function say(t,err){msg.textContent=t;msg.className="msg"+(err?" err":"")}
function shown(){var k=store.get();forget.hidden=!k;if(k)keyIn.placeholder="Your key is saved on this device"}
function text(){var el=$(b.dataset.text);return el?String(el.value||"").trim():""}
function speak(k){var t=text();if(!t){say("Type something in the box above first.",true);return}
var lim=MAX,cut=t.length>lim;if(cut)t=t.slice(0,lim);
var v=voice.value.split(":");play.disabled=true;say("Making the audio...");
fetch("/v1/audio/speech",{method:"POST",headers:{"authorization":"Bearer "+k,"content-type":"application/json"},body:JSON.stringify({input:t,voice:v[1],language:v[0]})}).then(function(r){
if(r.ok)return r.blob().then(function(bl){if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(bl);audio.src=url;audio.hidden=false;audio.play().catch(function(){});
say(cut?"Studio voices read up to "+lim.toLocaleString()+" characters at a time; this is the first part.":"Done. Use the player's menu to download the MP3.")});
return r.json().catch(function(){return {}}).then(function(j){var e=j&&j.error;var m=(e&&e.message)||(typeof e==="string"?e:"")||"The audio could not be made (HTTP "+r.status+").";if(r.status===401){store.set("");shown()}say(m,true)})
}).catch(function(){say("The request did not get through. Check your connection and try again.",true)}).then(function(){play.disabled=false})}
play.addEventListener("click",function(){var k=store.get();if(!k){say("Studio voices need a paid key. Paste yours under \\u201cI have a key\\u201d.",true);return}speak(k)});
save.addEventListener("click",function(){var k=keyIn.value.trim();if(!/^adt_[A-Za-z0-9_-]{20,80}$/.test(k)){say("That does not look like a key. It starts with adt_.",true);return}store.set(k);keyIn.value="";shown();say("Key saved on this device. Press Play with a studio voice.")});
forget.addEventListener("click",function(){store.set("");keyIn.placeholder="Paste your key (it starts with adt_)";shown();say("The key was removed from this device.")});
shown()})();</script>`;
}
