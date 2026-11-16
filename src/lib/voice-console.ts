// The free voice console: text to speech and speech to text that run in the visitor's own browser, on the front page
// of glyphcall.com and on the two voice product pages. Nothing is uploaded and nothing is charged.
//
// Owner, 16 Nov 2026: "make glyphcall.com way easier to use ... we want to be better than ElevenLabs at that".
// Measured that day: ElevenLabs' homepage has no input box (its try box is two clicks in, on /text-to-speech), and its
// users' top complaints are credits that run out while auditioning voices, paid retries and billing surprises. So:
// - the tool is the hero: text is already filled in and a voice is chosen, one click on Play speaks it;
// - voice previews, retries and downloads are free and unlimited, because the models run on the visitor's device;
// - playback starts with the first sentence while the rest is still being made;
// - any one sentence can be edited and redone alone and is spliced into the same download (their users regenerate a
//   whole paragraph, and pay for it, to fix one word);
// - one console for both jobs; a recording dropped anywhere on it is transcribed.
//
// The models are the ones the free tools at voice.glyphcall.com use (Kokoro 82M for speech, Whisper base for
// listening), fetched once from Hugging Face through the transformers runtime on jsDelivr and cached by the browser.
// The web workers are built from blob URLs, so no extra route or asset is needed. The download starts only when the
// visitor first uses the console, never on page load (88 MB for the voice, measured 16 Nov 2026).
//
// Copy rules: no payment protocol word (tests/site-pages.test.cjs), no speed claim (not measured fairly), and nothing
// promised that the browser tools do not do.

/** The free in-browser tools on their own subdomains (Cloudflare Pages projects glyphcall-voice and glyphcall-studio). */
export const VOICE_SITE = "https://voice.glyphcall.com";
export const STUDIO_SITE = "https://studio.glyphcall.com";

export interface ConsoleVoice { id: string; name: string; accent: string; gender: string; hello: string }

/** Curated English voices of Kokoro-82M v1.0 (all Apache 2.0). The first is preselected. */
export const CONSOLE_VOICES: readonly ConsoleVoice[] = [
  { id: "af_heart", name: "Heart", accent: "American", gender: "female", hello: "Hi, I'm Heart. Type anything and I'll read it out." },
  { id: "am_michael", name: "Michael", accent: "American", gender: "male", hello: "Hello, I'm Michael. Paste your script and press play." },
  { id: "bf_emma", name: "Emma", accent: "British", gender: "female", hello: "Hello, I'm Emma. I can read your article aloud." },
  { id: "bm_george", name: "George", accent: "British", gender: "male", hello: "Good day, I'm George. Shall I narrate your story?" },
  { id: "af_bella", name: "Bella", accent: "American", gender: "female", hello: "Hey, I'm Bella. I'm great for videos and ads." },
  { id: "am_fenrir", name: "Fenrir", accent: "American", gender: "male", hello: "I'm Fenrir. A deeper voice for trailers and games." },
];

/** Whisper language names (the model needs one named, or it translates to English). */
export const CONSOLE_LANGUAGES: readonly [value: string, label: string][] = [
  ["english", "English"], ["spanish", "Spanish"], ["french", "French"], ["german", "German"], ["italian", "Italian"],
  ["portuguese", "Portuguese"], ["dutch", "Dutch"], ["swedish", "Swedish"], ["norwegian", "Norwegian"], ["danish", "Danish"],
  ["finnish", "Finnish"], ["polish", "Polish"], ["turkish", "Turkish"], ["russian", "Russian"], ["ukrainian", "Ukrainian"],
  ["arabic", "Arabic"], ["hindi", "Hindi"], ["japanese", "Japanese"], ["korean", "Korean"], ["chinese", "Chinese"],
];

export const CONSOLE_SAMPLE = "Welcome! This voice is being made right now, on your own computer. Change this text to anything you like, pick a voice, and press Play. There is no account, no credit counter, and no limit.";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Styles. The host page sets the --vc-* colours on .vc (the defaults are the dark front page). */
export const VOICE_CONSOLE_CSS = `.vc{--vc-card:#11111c;--vc-card2:#0b0b13;--vc-line:#25253a;--vc-fg:#f4f4fb;--vc-muted:#a3a3bf;--vc-accent:#22d3ee;--vc-btn:linear-gradient(100deg,#a78bfa,#22d3ee);--vc-btn-fg:#07070c;--vc-ok:#34d399;--vc-err:#fca5a5;position:relative;border-radius:18px;border:1px solid var(--vc-line);background:var(--vc-card);color:var(--vc-fg);overflow:hidden;text-align:left}
.vc *{box-sizing:border-box}.vc [hidden]{display:none!important}
.vc-tabs{display:flex;border-bottom:1px solid var(--vc-line)}.vc-tabs button{flex:1;appearance:none;border:0;background:none;color:var(--vc-muted);font:inherit;font-weight:650;padding:14px 10px;cursor:pointer;border-bottom:2px solid transparent}
.vc-tabs button[aria-selected=true]{color:var(--vc-fg);border-bottom-color:var(--vc-accent);background:rgba(127,127,160,.07)}.vc-tabs button:focus-visible{outline:2px solid var(--vc-accent);outline-offset:-2px}
.vc-pane{padding:16px}
.vc textarea{display:block;width:100%;min-height:118px;resize:vertical;border-radius:12px;border:1px solid var(--vc-line);background:var(--vc-card2);color:var(--vc-fg);font:inherit;font-size:1rem;line-height:1.55;padding:12px 14px}
.vc textarea:focus,.vc select:focus{outline:2px solid var(--vc-accent);outline-offset:1px}
.vc-meta{display:flex;justify-content:space-between;gap:10px;color:var(--vc-muted);font-size:.8rem;margin:6px 2px 12px}
.vc-voices{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}.vc-voices button{appearance:none;font:inherit;font-size:.86rem;border:1px solid var(--vc-line);background:none;color:var(--vc-fg);padding:6px 11px;border-radius:999px;cursor:pointer}
.vc-voices button small{color:var(--vc-muted);margin-left:5px}.vc-voices button[aria-pressed=true]{border-color:var(--vc-accent);background:rgba(34,211,238,.12)}
.vc-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.vc-go{appearance:none;border:0;border-radius:12px;background:var(--vc-btn);color:var(--vc-btn-fg);font:inherit;font-weight:750;font-size:1rem;padding:12px 22px;cursor:pointer;min-width:132px}
.vc-go:disabled{opacity:.6;cursor:progress}.vc-go:focus-visible,.vc-sec:focus-visible{outline:2px solid var(--vc-fg);outline-offset:2px}
.vc-sec{appearance:none;font:inherit;font-size:.9rem;font-weight:600;border:1px solid var(--vc-line);background:none;color:var(--vc-fg);padding:9px 14px;border-radius:10px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.vc-sec:hover{border-color:var(--vc-accent);text-decoration:none}
.vc-speed{display:flex;align-items:center;gap:8px;color:var(--vc-muted);font-size:.85rem;margin-left:auto}.vc-speed input{width:96px;accent-color:var(--vc-accent)}
.vc-status{min-height:1.4em;color:var(--vc-muted);font-size:.88rem;margin:12px 2px 0}.vc-status.err{color:var(--vc-err)}.vc-status.ok{color:var(--vc-ok)}
.vc progress{display:block;width:100%;height:6px;margin:8px 0 0;accent-color:var(--vc-accent)}
.vc-out{margin-top:12px;padding:12px;border-radius:12px;border:1px solid var(--vc-line);background:var(--vc-card2)}.vc-out audio{width:100%;margin:0 0 10px}
.vc-drop{display:grid;place-items:center;gap:8px;text-align:center;border:2px dashed var(--vc-line);border-radius:14px;padding:26px 14px;cursor:pointer;color:var(--vc-muted)}
.vc-drop b{color:var(--vc-fg);font-size:1.05rem}.vc-drop:hover,.vc.over .vc-drop{border-color:var(--vc-accent);background:rgba(34,211,238,.06)}
.vc-drop input{position:absolute;width:1px;height:1px;opacity:0}
.vc-opts{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0 0}.vc select{font:inherit;font-size:.9rem;border-radius:10px;border:1px solid var(--vc-line);background:var(--vc-card2);color:var(--vc-fg);padding:8px 10px}
.vc-rec.on{border-color:#f87171;color:#fecaca}
.vc-foot{border-top:1px solid var(--vc-line);padding:10px 16px;color:var(--vc-muted);font-size:.8rem;display:flex;flex-wrap:wrap;gap:4px 16px}.vc-foot span::before{content:"\\2713";color:var(--vc-ok);font-weight:800;margin-right:6px}
.vc-fix{margin:0 0 10px}.vc-fix summary{cursor:pointer;color:var(--vc-accent);font-size:.88rem;font-weight:600}.vc-fix ol{margin:8px 0 0;padding-left:22px;display:grid;gap:6px;max-height:260px;overflow:auto}
.vc-fix li{color:var(--vc-muted);font-size:.85rem}.vc-fix li div{display:flex;gap:6px}.vc-fix input{flex:1;min-width:0;font:inherit;font-size:.9rem;border-radius:8px;border:1px solid var(--vc-line);background:var(--vc-card);color:var(--vc-fg);padding:6px 8px}.vc-fix button{padding:6px 10px}
.vc kbd{font:inherit;font-size:.75rem;border:1px solid var(--vc-line);border-bottom-width:2px;border-radius:5px;padding:0 5px}
@media (max-width:520px){.vc-speed{margin-left:0;width:100%}.vc-go{flex:1}}`;

/**
 * The console's markup. `id` prefixes every element id so the page can hold it once; `upsell` is a short line under
 * the results that names the paid way to do the same job at scale (HTML, already escaped by the caller).
 */
export function voiceConsole(opts: { id?: string; first?: "tts" | "stt"; voiceSite: string; upsellTts?: string; upsellStt?: string; className?: string }): string {
  const id = opts.id ?? "vc";
  const first = opts.first ?? "tts";
  const v = (s: string) => `${id}-${s}`;
  const voices = CONSOLE_VOICES.map((x, i) => `<button type="button" data-voice="${esc(x.id)}" aria-pressed="${i === 0}" title="${esc(`${x.accent} ${x.gender}. Click again to hear a preview.`)}">${esc(x.name)}<small>${esc(x.accent === "British" ? "UK" : "US")} ${esc(x.gender === "female" ? "F" : "M")}</small></button>`).join("");
  const langs = CONSOLE_LANGUAGES.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
  return `<div class="vc${opts.className ? ` ${esc(opts.className)}` : ""}" id="${esc(id)}" data-first="${first}">
<div class="vc-tabs" role="tablist" aria-label="Free voice tools"><button type="button" role="tab" id="${v("t-tts")}" aria-controls="${v("tts")}" aria-selected="${first === "tts"}">Text to speech</button><button type="button" role="tab" id="${v("t-stt")}" aria-controls="${v("stt")}" aria-selected="${first === "stt"}">Speech to text</button></div>
<div class="vc-pane" id="${v("tts")}" role="tabpanel" aria-labelledby="${v("t-tts")}"${first === "tts" ? "" : " hidden"}>
<label class="sr" for="${v("text")}" style="position:absolute;left:-9999px">Text to speak</label>
<textarea id="${v("text")}" spellcheck="true" maxlength="200000">${esc(CONSOLE_SAMPLE)}</textarea>
<div class="vc-meta"><span id="${v("count")}"></span><span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to play</span></div>
<div class="vc-voices" role="group" aria-label="Voice">${voices}</div>
<div class="vc-row"><button type="button" class="vc-go" id="${v("speak")}">&#9654; Play</button><button type="button" class="vc-sec" id="${v("stop")}" hidden>&#9632; Stop</button>
<label class="vc-speed">Speed <input type="range" id="${v("speed")}" min="0.6" max="1.6" step="0.1" value="1"><span id="${v("speedv")}">1.0x</span></label></div>
<progress id="${v("tbar")}" max="1" hidden></progress><p class="vc-status" id="${v("tstatus")}" role="status" aria-live="polite">First play fetches the voice once (about 90 MB), then it starts in seconds.</p>
<div class="vc-out" id="${v("tout")}" hidden><audio id="${v("player")}" controls></audio><details class="vc-fix"><summary>Fix one sentence without redoing the rest</summary><ol id="${v("sents")}"></ol></details><div class="vc-row"><a class="vc-sec" id="${v("wav")}" download="glyphcall-speech.wav" href="#">Download WAV</a><button type="button" class="vc-sec" id="${v("mp3")}">Download MP3</button></div>${opts.upsellTts ? `<p class="vc-status">${opts.upsellTts}</p>` : ""}</div>
</div>
<div class="vc-pane" id="${v("stt")}" role="tabpanel" aria-labelledby="${v("t-stt")}"${first === "stt" ? "" : " hidden"}>
<label class="vc-drop" id="${v("drop")}"><input type="file" id="${v("file")}" accept="audio/*,video/*,.mp3,.m4a,.wav,.ogg,.opus,.webm,.mp4,.mov,.flac,.aac"><b>Drop a recording here, or click to choose one</b><span>MP3, M4A, WAV, OGG, WebM or a video. It stays on your computer.</span></label>
<div class="vc-opts"><button type="button" class="vc-sec vc-rec" id="${v("rec")}">&#9679; Record from the microphone</button><label>Spoken language <select id="${v("lang")}">${langs}</select></label></div>
<progress id="${v("sbar")}" max="1" hidden></progress><p class="vc-status" id="${v("sstatus")}" role="status" aria-live="polite">The first time, your browser fetches the listening model once; after that it starts straight away.</p>
<div class="vc-out" id="${v("sout")}" hidden><textarea id="${v("transcript")}" aria-label="Transcript" spellcheck="true"></textarea><div class="vc-row" style="margin-top:10px"><button type="button" class="vc-sec" id="${v("copy")}">Copy text</button><button type="button" class="vc-sec" data-fmt="txt">TXT</button><button type="button" class="vc-sec" data-fmt="srt">SRT subtitles</button><button type="button" class="vc-sec" data-fmt="vtt">VTT</button></div>${opts.upsellStt ? `<p class="vc-status">${opts.upsellStt}</p>` : ""}</div>
</div>
<div class="vc-foot"><span>No account</span><span>No credits or limits</span><span>Nothing uploaded</span><span>Free downloads</span></div>
<noscript><p class="vc-pane">This console needs JavaScript. The same tools: <a href="${esc(opts.voiceSite)}/text-to-speech">text to speech</a> and <a href="${esc(opts.voiceSite)}/transcribe">transcription</a>.</p></noscript>
</div>`;
}

// The web workers. Kept close to voice.glyphcall.com's tts-worker.js and stt-worker.js, with two changes: speech is
// posted sentence by sentence (so playback starts early) and a running job can be cancelled.
const TTS_WORKER = `import { KokoroTTS, TextSplitterStream } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
let tts=null,loading=null,cancelled=0;
const progress=(p)=>{if(p&&p.status==="progress"&&p.total)self.postMessage({type:"download",file:p.file,loaded:p.loaded,total:p.total});};
function load(){if(tts)return Promise.resolve(tts);if(!loading)loading=KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX",{dtype:"q8",device:"wasm",progress_callback:progress}).then((m)=>(tts=m));return loading;}
self.onmessage=async(e)=>{const m=e.data;if(m.type==="cancel"){cancelled=m.id;return;}
try{const model=await load();self.postMessage({type:"ready",id:m.id});if(m.type!=="speak")return;
const s=new TextSplitterStream();s.push(m.text);s.close();let done=0;
for await(const piece of model.stream(s,{voice:m.voice,speed:m.speed})){if(cancelled===m.id)return;const a=piece.audio;done+=(piece.text||"").length;const pcm=a.audio;self.postMessage({type:"chunk",id:m.id,pcm,text:piece.text||"",rate:a.sampling_rate,done,total:m.text.length},[pcm.buffer]);}
self.postMessage({type:"end",id:m.id});}catch(err){self.postMessage({type:"error",id:m.id,message:String((err&&err.message)||err)});}};`;

const STT_WORKER = `import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";
const RATE=16000,BLOCK=90*RATE;let asr=null,loading=null,gpu=false;
const progress=(p)=>{if(p&&p.status==="progress"&&p.total)self.postMessage({type:"download",file:p.file,loaded:p.loaded,total:p.total});};
// The 8-bit CPU build only: the graphics build of the same model fetched over 270 MB on 16 Nov, too much for a first try.
function load(){if(asr)return Promise.resolve(asr);if(!loading)loading=pipeline("automatic-speech-recognition","onnx-community/whisper-base",{device:"wasm",dtype:"q8",progress_callback:progress}).then((m)=>(asr=m));return loading;}
self.onmessage=async(e)=>{const m=e.data;try{const model=await load();self.postMessage({type:"ready",gpu});if(m.type!=="transcribe")return;
const pcm=m.pcm,total=pcm.length/RATE,segs=[],o={chunk_length_s:30,stride_length_s:5,return_timestamps:true,task:"transcribe",language:m.language||"english"};
for(let st=0;st<pcm.length;st+=BLOCK){const b=pcm.subarray(st,Math.min(pcm.length,st+BLOCK)),off=st/RATE,out=await model(b,o),ch=(out&&out.chunks)||[];
if(!ch.length&&out&&out.text)segs.push({start:off,end:off+b.length/RATE,text:out.text.trim()});
for(const c of ch){const t=(c.text||"").trim();if(!t)continue;const s=(c.timestamp&&c.timestamp[0])||0;let en=c.timestamp&&c.timestamp[1];if(en==null||en<s)en=Math.min(b.length/RATE,s+5);segs.push({start:off+s,end:off+en,text:t});}
self.postMessage({type:"progress",done:Math.min(total,off+b.length/RATE),total,segments:segs});}
self.postMessage({type:"result",segments:segs,seconds:total});}catch(err){self.postMessage({type:"error",message:String((err&&err.message)||err)});}};`;

/** The console's script, once per page; it wires every .vc element. Inline, no framework, no tracking. */
export function voiceConsoleScript(): string {
  const voices = JSON.stringify(Object.fromEntries(CONSOLE_VOICES.map((x) => [x.id, x.hello])));
  return `<script>(()=>{"use strict";
const TTS_SRC=${JSON.stringify(TTS_WORKER)},STT_SRC=${JSON.stringify(STT_WORKER)},HELLO=${voices.replace(/</g, "\\u003c")};
const mk=(src)=>new Worker(URL.createObjectURL(new Blob([src],{type:"text/javascript"})),{type:"module"});
const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
const mb=(n)=>Math.round(n/1048576);
function dl(){const files={};return(m)=>{files[m.file]=m;let l=0,t=0;for(const f of Object.values(files)){l+=f.loaded;t+=f.total;}return{l,t};};}
function toWav(parts,rate){let n=0;for(const p of parts)n+=p.length;const buf=new ArrayBuffer(44+n*2),dv=new DataView(buf),w=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i));};
w(0,"RIFF");dv.setUint32(4,36+n*2,true);w(8,"WAVEfmt ");dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,rate,true);dv.setUint32(28,rate*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);w(36,"data");dv.setUint32(40,n*2,true);
const out=new Int16Array(buf,44);let o=0;for(const p of parts)for(let i=0;i<p.length;i++){const s=Math.max(-1,Math.min(1,p[i]));out[o++]=s<0?s*32768:s*32767;}return new Blob([buf],{type:"audio/wav"});}
function lame(){return window.lamejs?Promise.resolve(window.lamejs):new Promise((ok,no)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";s.onload=()=>ok(window.lamejs);s.onerror=()=>no(new Error("the MP3 encoder could not be loaded"));document.head.appendChild(s);});}
async function toMp3(parts,rate){const L=await lame(),enc=new L.Mp3Encoder(1,rate,64),out=[],B=1152,blk=new Int16Array(B);
for(const p of parts)for(let i=0;i<p.length;i+=B){const n=Math.min(B,p.length-i);for(let j=0;j<n;j++){const s=Math.max(-1,Math.min(1,p[i+j]));blk[j]=s<0?s*32768:s*32767;}const b=enc.encodeBuffer(n===B?blk:blk.subarray(0,n));if(b.length)out.push(new Uint8Array(b));}
const e=enc.flush();if(e.length)out.push(new Uint8Array(e));return new Blob(out,{type:"audio/mpeg"});}
const stamp=(t,sep)=>{const ms=Math.max(0,Math.round(t*1000)),p=(n,w)=>String(n).padStart(w,"0");return p(Math.floor(ms/3600000),2)+":"+p(Math.floor(ms/60000)%60,2)+":"+p(Math.floor(ms/1000)%60,2)+sep+p(ms%1000,3);};
const fmt={txt:(s)=>s.map((x)=>x.text).join(" ").replace(/\\s+/g," ").trim(),srt:(s)=>s.map((x,i)=>(i+1)+"\\n"+stamp(x.start,",")+" --> "+stamp(x.end,",")+"\\n"+x.text+"\\n").join("\\n"),vtt:(s)=>"WEBVTT\\n\\n"+s.map((x)=>stamp(x.start,".")+" --> "+stamp(x.end,".")+"\\n"+x.text+"\\n").join("\\n")};
function save(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);}
document.querySelectorAll(".vc").forEach((root)=>{const id=root.id,$=(s)=>document.getElementById(id+"-"+s);
const say=(el,msg,cls)=>{el.textContent=msg;el.className="vc-status"+(cls?" "+cls:"");};
// Tabs
const tabs={tts:$("t-tts"),stt:$("t-stt")};
function show(k){for(const [n,b] of Object.entries(tabs)){const on=n===k;b.setAttribute("aria-selected",String(on));$(n).hidden=!on;}}
tabs.tts.onclick=()=>show("tts");tabs.stt.onclick=()=>show("stt");
root.querySelector(".vc-tabs").addEventListener("keydown",(e)=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){const k=tabs.tts.getAttribute("aria-selected")==="true"?"stt":"tts";show(k);tabs[k].focus();}});
// Text to speech
const text=$("text"),count=$("count"),speak=$("speak"),stop=$("stop"),speed=$("speed"),tbar=$("tbar"),tst=$("tstatus"),tout=$("tout"),player=$("player"),wav=$("wav");
const saved=store.get("gc-vc-text");if(saved)text.value=saved;
const upd=()=>{count.textContent=text.value.length.toLocaleString()+" characters, no limit";};upd();
text.addEventListener("input",()=>{upd();store.set("gc-vc-text",text.value);});
speed.oninput=()=>{$("speedv").textContent=Number(speed.value).toFixed(1)+"x";};
let voice=store.get("gc-vc-voice")||"af_heart";const chips=root.querySelectorAll("[data-voice]");
const mark=()=>chips.forEach((c)=>c.setAttribute("aria-pressed",String(c.dataset.voice===voice)));if(![...chips].some((c)=>c.dataset.voice===voice))voice="af_heart";mark();
// mode: "main" builds the result sentence by sentence, "redo" replaces one sentence of it, "preview" only plays.
let tw=null,ready=false,job=0,ctx=null,next=0,sents=[],mode="main",redoAt=-1,redoBuf=[],redoText="",rate=24000,last=null,t0=0,first=0;const tdl=dl();
const sentList=$("sents"),attr=(s)=>s.replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const flat=()=>{const out=[];for(const s of sents){for(const p of s.pcm)out.push(p);out.push(new Float32Array(Math.round(rate*0.12)));}return out;};
function listSents(){sentList.innerHTML=sents.map((s,i)=>'<li><div><input aria-label="Sentence '+(i+1)+'" value="'+attr(s.text.trim())+'"><button type="button" class="vc-sec" data-redo="'+i+'">Redo</button></div></li>').join("");}
sentList.addEventListener("click",(e)=>{const b=e.target.closest("[data-redo]");if(!b||speak.disabled)return;const i=Number(b.dataset.redo),t=b.previousElementSibling.value.trim();if(t)redoOne(i,t);});
sentList.addEventListener("keydown",(e)=>{if(e.key==="Enter"&&e.target.tagName==="INPUT"){e.preventDefault();e.target.nextElementSibling.click();}});
function tworker(){if(tw)return tw;tw=mk(TTS_SRC);tw.onmessage=(e)=>{const m=e.data;
if(m.type==="download"){const {l,t}=tdl(m);tbar.hidden=false;tbar.value=t?l/t:0;say(tst,"Fetching the voice (first time only): "+mb(l)+" of "+mb(t)+" MB");}
else if(m.type==="ready"){if(!ready){ready=true;tbar.hidden=true;if(!busy())say(tst,"Voice ready. Press Play, or click a voice name twice to hear it.","ok");}}
else if(m.type==="chunk"&&m.id===job){rate=m.rate;if(mode==="main")sents.push({text:m.text,pcm:[m.pcm]});else if(mode==="redo")redoBuf.push(m.pcm);
if(ctx){const b=ctx.createBuffer(1,m.pcm.length,rate);b.copyToChannel(m.pcm,0);const s=ctx.createBufferSource();s.buffer=b;s.playbackRate.value=1;s.connect(ctx.destination);next=Math.max(next,ctx.currentTime+0.05);s.start(next);next+=b.duration+0.12;}
if(!first){first=performance.now();}tbar.hidden=false;tbar.value=Math.min(1,m.done/m.total);say(tst,"Speaking while the rest is made: "+Math.round(100*Math.min(1,m.done/m.total))+"%");}
else if(m.type==="end"&&m.id===job){finish();}
else if(m.type==="error"){mode="main";tbar.hidden=true;speak.disabled=false;stop.hidden=true;say(tst,"That did not work: "+m.message+". Reload the page and try again.","err");}};
tw.onerror=(e)=>{tbar.hidden=true;speak.disabled=false;say(tst,"The voice could not be loaded"+(e.message?": "+e.message:"")+". Check your connection and try again.","err");};return tw;}
const busy=()=>speak.disabled;
function warm(){if(!tw){tworker().postMessage({type:"load",id:0});if(!ready)say(tst,"Fetching the voice (first time only)...");}}
function finish(cancelled){speak.disabled=false;stop.hidden=true;tbar.hidden=true;const was=mode;mode="main";
if(was==="preview"){if(!cancelled)say(tst,"That was "+preview+". Press Play to hear your own text in this voice.","ok");return;}
if(was==="redo"){const ok=!cancelled&&redoBuf.length;if(ok){sents[redoAt].pcm=redoBuf;sents[redoAt].text=redoText;}redoBuf=[];if(!ok)return;}
if(!sents.length)return;const audio=flat();
last={parts:audio,rate};const blob=toWav(audio,rate);if(wav.href.startsWith("blob:"))URL.revokeObjectURL(wav.href);const url=URL.createObjectURL(blob);wav.href=url;player.src=url;tout.hidden=false;listSents();
let secs=0;for(const p of audio)secs+=p.length;say(tst,was==="redo"?"Sentence "+(redoAt+1)+" redone; the download has the new take.":"Done: "+(secs/rate).toFixed(1)+" seconds of audio. Edit the text and press Play to make it again, or fix one sentence below. Free.","ok");}
let preview="";
function redoOne(i,t){mode="redo";redoAt=i;redoBuf=[];redoText=t;run(t,voice);}
function go(str,v,who){if(!(str||"").trim()){say(tst,"Type something to hear first.","err");text.focus();return;}preview=who||"";mode=who?"preview":"main";if(!who)sents=[];run(str,v);}
function run(str,v){const s=str.trim();
const C=window.AudioContext||window.webkitAudioContext;if(ctx)ctx.close().catch(()=>{});ctx=C?new C():null;next=0;first=0;t0=performance.now();
job++;speak.disabled=true;stop.hidden=false;tbar.hidden=false;tbar.removeAttribute("value");if(ready)say(tst,"Making the first sentence...");else say(tst,"Fetching the voice (first time only)...");
tworker().postMessage({type:"speak",id:job,text:s,voice:v||voice,speed:Number(speed.value)});}
speak.onclick=()=>go(text.value);
stop.onclick=()=>{const j=job;job++;if(tw)tw.postMessage({type:"cancel",id:j});if(ctx){ctx.close().catch(()=>{});ctx=null;}finish(mode!=="main");say(tst,"Stopped. Press Play to start again.");};
text.addEventListener("keydown",(e)=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();if(!speak.disabled)go(text.value);}});
chips.forEach((c)=>c.onclick=()=>{const again=voice===c.dataset.voice;voice=c.dataset.voice;store.set("gc-vc-voice",voice);mark();if(again||ready){if(!speak.disabled)go(HELLO[voice]||"Hello.",voice,c.firstChild.textContent);}else warm();});
text.addEventListener("focus",warm,{once:true});
$("mp3").onclick=async(e)=>{if(!last)return;const b=e.currentTarget;b.disabled=true;b.textContent="Encoding...";try{save(await toMp3(last.parts,last.rate),"glyphcall-speech.mp3");}catch(err){say(tst,String(err.message||err),"err");}b.disabled=false;b.textContent="Download MP3";};
// Speech to text
const drop=$("drop"),file=$("file"),rec=$("rec"),lang=$("lang"),sbar=$("sbar"),sst=$("sstatus"),sout=$("sout"),tr=$("transcript");
const lg=store.get("gc-vc-lang");if(lg)lang.value=lg;lang.onchange=()=>store.set("gc-vc-lang",lang.value);
let sw=null,segs=[],sdl=dl(),sbusy=false,tl=0,base="recording";
function sworker(){if(sw)return sw;sw=mk(STT_SRC);sw.onmessage=(e)=>{const m=e.data;
if(m.type==="download"){const {l,t}=sdl(m);sbar.value=t?l/t:0;say(sst,"Fetching the listening model (first time only): "+mb(l)+" of "+mb(t)+" MB");}
else if(m.type==="ready"){sbar.removeAttribute("value");say(sst,"Listening...");tl=performance.now();}
else if(m.type==="progress"){segs=m.segments;tr.value=fmt.txt(segs);sout.hidden=false;const f=m.done/m.total;sbar.value=f;const left=f>0.03?((performance.now()-tl)/1000)*(1-f)/f:0;say(sst,"Listening: "+Math.round(100*f)+"%"+(left>90?" (about "+Math.round(left/60)+" min left)":""));}
else if(m.type==="result"){segs=m.segments;tr.value=fmt.txt(segs);sout.hidden=false;sbar.hidden=true;sbusy=false;say(sst,segs.length?"Done: "+Math.round(m.seconds)+" seconds of audio. Edit the text, copy it or download it.":"Done, but no speech was found. Is the right language chosen?",segs.length?"ok":"err");}
else if(m.type==="error"){sbar.hidden=true;sbusy=false;say(sst,"That did not work: "+m.message,"err");}};
sw.onerror=(e)=>{sbar.hidden=true;sbusy=false;say(sst,"The listening model could not be loaded"+(e.message?": "+e.message:"")+".","err");};return sw;}
async function decode(f){const buf=await f.arrayBuffer(),C=window.AudioContext||window.webkitAudioContext,c=new C({sampleRate:16000});try{const a=await c.decodeAudioData(buf),n=a.length,mono=new Float32Array(n),ch=a.numberOfChannels;for(let k=0;k<ch;k++){const d=a.getChannelData(k);for(let i=0;i<n;i++)mono[i]+=d[i]/ch;}return mono;}finally{c.close();}}
async function take(f){if(!f)return;if(sbusy){say(sst,"Still listening to the last file; one at a time.","err");return;}show("stt");base=(f.name||"recording").replace(/\\.[^.]+$/,"")||"recording";
sbusy=true;segs=[];tr.value="";sbar.hidden=false;sbar.removeAttribute("value");say(sst,"Reading "+(f.name||"the recording")+"...");let pcm;
try{pcm=await decode(f);}catch{sbar.hidden=true;sbusy=false;say(sst,"This file could not be read as audio. Try MP3, M4A, WAV or a video file.","err");return;}
if(!pcm.length){sbar.hidden=true;sbusy=false;say(sst,"This file has no audio.","err");return;}
sworker().postMessage({type:"transcribe",pcm,language:lang.value},[pcm.buffer]);}
file.onchange=()=>{take(file.files[0]);file.value="";};
["dragenter","dragover"].forEach((t)=>root.addEventListener(t,(e)=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes("Files")){e.preventDefault();root.classList.add("over");}}));
["dragleave","drop"].forEach((t)=>root.addEventListener(t,(e)=>{if(t==="dragleave"&&root.contains(e.relatedTarget))return;root.classList.remove("over");}));
root.addEventListener("drop",(e)=>{const f=e.dataTransfer&&e.dataTransfer.files[0];if(!f)return;e.preventDefault();
if(/^text\\//.test(f.type)||/\\.(txt|md)$/i.test(f.name)){f.text().then((s)=>{show("tts");text.value=s;upd();store.set("gc-vc-text",s);say(tst,"Loaded "+f.name+". Press Play.","ok");});return;}take(f);});
if(navigator.mediaDevices&&window.MediaRecorder){let r=null,chunks=[],tick=0,began=0;rec.onclick=async()=>{if(r&&r.state==="recording"){r.stop();return;}
try{const st=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];r=new MediaRecorder(st);r.ondataavailable=(e)=>{if(e.data.size)chunks.push(e.data);};
r.onstop=()=>{clearInterval(tick);st.getTracks().forEach((t)=>t.stop());rec.classList.remove("on");rec.textContent="\\u25CF Record again";const type=r.mimeType||"audio/webm";take(new File(chunks,"recording."+(type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm"),{type}));};
r.start(1000);began=Date.now();rec.classList.add("on");rec.textContent="\\u25A0 Stop and transcribe";tick=setInterval(()=>{const s=Math.round((Date.now()-began)/1000);say(sst,"Recording "+Math.floor(s/60)+":"+String(s%60).padStart(2,"0")+". Press Stop when you are done.");},500);}
catch(err){say(sst,"The microphone could not be used: "+(err&&err.message?err.message:err)+". Allow microphone access for this site and try again.","err");}};}else rec.hidden=true;
$("copy").onclick=async(e)=>{try{await navigator.clipboard.writeText(tr.value);e.currentTarget.textContent="Copied";}catch{tr.select();document.execCommand("copy");}};
root.querySelectorAll("[data-fmt]").forEach((b)=>b.onclick=()=>{const k=b.dataset.fmt;if(!segs.length&&!tr.value)return;const body=k==="txt"?tr.value:fmt[k](segs);save(new Blob([body],{type:k==="vtt"?"text/vtt":"text/plain"}),base+"."+k);});
});})();</script>`;
}
