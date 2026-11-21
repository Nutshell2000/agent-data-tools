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

/** `lang`: the voice's language group (Kokoro voice prefix a/b = English US/UK; e, f, i, p, h through espeak-ng). */
export interface ConsoleVoice { id: string; name: string; accent: string; gender: string; hello: string; lang: ConsoleVoiceLang }
export type ConsoleVoiceLang = "en-us" | "en-gb" | "es" | "fr" | "it" | "pt-br" | "hi";

/** The language groups, in the order "More voices" shows them, with the chip label. */
export const CONSOLE_VOICE_LANGS: readonly { lang: ConsoleVoiceLang; label: string; short: string }[] = [
  { lang: "en-us", label: "English (American)", short: "US" }, { lang: "en-gb", label: "English (British)", short: "UK" },
  { lang: "es", label: "Español", short: "ES" }, { lang: "fr", label: "Français", short: "FR" }, { lang: "it", label: "Italiano", short: "IT" },
  { lang: "pt-br", label: "Português (Brasil)", short: "BR" }, { lang: "hi", label: "हिन्दी (Hindi)", short: "HI" },
];

/** The accent or language shown on a chip's tooltip, from the voice's language group. */
const accentOf = (lang: ConsoleVoiceLang) => (lang === "en-us" ? "American" : lang === "en-gb" ? "British" : CONSOLE_VOICE_LANGS.find((l) => l.lang === lang)!.label);

/**
 * The 41 voices of Kokoro-82M v1.0 that voice.glyphcall.com offers (all Apache 2.0): 28 English (US and UK), then
 * Spanish, French, Italian, Brazilian Portuguese and Hindi (21 Nov 2026, parity with its tts.js). The first is
 * preselected and the first CONSOLE_VOICES_SHOWN are the chips; the rest sit under "More voices", grouped by language.
 * One object per voice (id, name, lang, gender, hello), so a further field per voice is a one-line add.
 */
export const CONSOLE_VOICES: readonly ConsoleVoice[] = ([
  { id: "af_heart", name: "Heart", lang: "en-us", gender: "female", hello: "Hi, I'm Heart. Type anything and I'll read it out." },
  { id: "am_michael", name: "Michael", lang: "en-us", gender: "male", hello: "Hello, I'm Michael. Paste your script and press play." },
  { id: "bf_emma", name: "Emma", lang: "en-gb", gender: "female", hello: "Hello, I'm Emma. I can read your article aloud." },
  { id: "bm_george", name: "George", lang: "en-gb", gender: "male", hello: "Good day, I'm George. Shall I narrate your story?" },
  { id: "af_bella", name: "Bella", lang: "en-us", gender: "female", hello: "Hey, I'm Bella. I'm great for videos and ads." },
  { id: "am_fenrir", name: "Fenrir", lang: "en-us", gender: "male", hello: "I'm Fenrir. A deeper voice for trailers and games." },
  { id: "af_nicole", name: "Nicole", lang: "en-us", gender: "female", hello: "Hi, I'm Nicole. A calm, close voice for audiobooks." },
  { id: "af_sarah", name: "Sarah", lang: "en-us", gender: "female", hello: "Hello, I'm Sarah. Clear and friendly for explainers." },
  { id: "af_sky", name: "Sky", lang: "en-us", gender: "female", hello: "Hi there, I'm Sky. Bright and light for social clips." },
  { id: "af_nova", name: "Nova", lang: "en-us", gender: "female", hello: "I'm Nova. Smooth and steady for long reads." },
  { id: "af_jessica", name: "Jessica", lang: "en-us", gender: "female", hello: "Hey, I'm Jessica. Easygoing and conversational." },
  { id: "am_adam", name: "Adam", lang: "en-us", gender: "male", hello: "Hello, I'm Adam. Warm and even for narration." },
  { id: "am_eric", name: "Eric", lang: "en-us", gender: "male", hello: "Hi, I'm Eric. Relaxed and clear for tutorials." },
  { id: "am_liam", name: "Liam", lang: "en-us", gender: "male", hello: "I'm Liam. Youthful and upbeat for product demos." },
  { id: "am_puck", name: "Puck", lang: "en-us", gender: "male", hello: "I'm Puck. A playful voice for characters and games." },
  { id: "af_aoede", name: "Aoede", lang: "en-us", gender: "female", hello: "Hello, I'm Aoede. A bright voice for stories and songs." },
  { id: "af_kore", name: "Kore", lang: "en-us", gender: "female", hello: "Hi, I'm Kore. Clear and confident for presentations." },
  { id: "af_alloy", name: "Alloy", lang: "en-us", gender: "female", hello: "Hello, I'm Alloy. Neutral and even for everyday reading." },
  { id: "af_river", name: "River", lang: "en-us", gender: "female", hello: "Hi, I'm River. Soft and easy for long listens." },
  { id: "am_echo", name: "Echo", lang: "en-us", gender: "male", hello: "Hello, I'm Echo. Steady and plain for instructions." },
  { id: "am_onyx", name: "Onyx", lang: "en-us", gender: "male", hello: "I'm Onyx. A low, rich voice for narration." },
  { id: "am_santa", name: "Santa", lang: "en-us", gender: "male", hello: "Ho ho, I'm Santa. A jolly voice for festive messages." },
  { id: "bf_alice", name: "Alice", lang: "en-gb", gender: "female", hello: "Hello, I'm Alice. Crisp and polished for presentations." },
  { id: "bf_isabella", name: "Isabella", lang: "en-gb", gender: "female", hello: "Good evening, I'm Isabella. Elegant for stories." },
  { id: "bf_lily", name: "Lily", lang: "en-gb", gender: "female", hello: "Hi, I'm Lily. Soft and gentle for bedtime reads." },
  { id: "bm_daniel", name: "Daniel", lang: "en-gb", gender: "male", hello: "Hello, I'm Daniel. Measured and authoritative." },
  { id: "bm_fable", name: "Fable", lang: "en-gb", gender: "male", hello: "I'm Fable. A storyteller's voice, made for tales." },
  { id: "bm_lewis", name: "Lewis", lang: "en-gb", gender: "male", hello: "Hi, I'm Lewis. Steady and clear for news and reports." },
  { id: "ef_dora", name: "Dora", lang: "es", gender: "female", hello: "Hola, soy Dora. Escribe lo que quieras y lo leo en voz alta." },
  { id: "em_alex", name: "Alex", lang: "es", gender: "male", hello: "Hola, soy Alex. Pega tu texto y pulsa reproducir." },
  { id: "em_santa", name: "Santa", lang: "es", gender: "male", hello: "Hola, soy Santa. Una voz alegre para tus mensajes." },
  { id: "ff_siwis", name: "Siwis", lang: "fr", gender: "female", hello: "Bonjour, je suis Siwis. Écrivez un texte et je le lis à voix haute." },
  { id: "if_sara", name: "Sara", lang: "it", gender: "female", hello: "Ciao, sono Sara. Scrivi qualcosa e lo leggo ad alta voce." },
  { id: "im_nicola", name: "Nicola", lang: "it", gender: "male", hello: "Ciao, sono Nicola. Incolla il tuo testo e premi play." },
  { id: "pf_dora", name: "Dora", lang: "pt-br", gender: "female", hello: "Olá, eu sou a Dora. Escreva qualquer coisa e eu leio em voz alta." },
  { id: "pm_alex", name: "Alex", lang: "pt-br", gender: "male", hello: "Olá, eu sou o Alex. Cole o seu texto e aperte play." },
  { id: "pm_santa", name: "Santa", lang: "pt-br", gender: "male", hello: "Olá, eu sou o Santa. Uma voz alegre para as suas mensagens." },
  { id: "hf_alpha", name: "Alpha", lang: "hi", gender: "female", hello: "नमस्ते, मैं अल्फ़ा हूँ। कुछ भी लिखिए, मैं उसे पढ़ूँगी।" },
  { id: "hf_beta", name: "Beta", lang: "hi", gender: "female", hello: "नमस्ते, मैं बीटा हूँ। अपना पाठ यहाँ लिखिए।" },
  { id: "hm_omega", name: "Omega", lang: "hi", gender: "male", hello: "नमस्ते, मैं ओमेगा हूँ। अपना पाठ चिपकाइए और चलाइए।" },
  { id: "hm_psi", name: "Psi", lang: "hi", gender: "male", hello: "नमस्ते, मैं साई हूँ। मैं आपकी कहानी पढ़ सकता हूँ।" },
] as Omit<ConsoleVoice, "accent">[]).map((x) => ({ ...x, accent: accentOf(x.lang) }));

/** A short starter text per non-English language, swapped in when a voice of that language is picked over the sample. */
export const CONSOLE_SAMPLES: Readonly<Partial<Record<ConsoleVoiceLang, string>>> = {
  es: "Hola. Esta voz se crea aquí mismo, en tu navegador.", fr: "Bonjour. Cette voix est créée ici même, dans votre navigateur.",
  it: "Ciao. Questa voce viene creata qui, nel tuo browser.", "pt-br": "Olá. Esta voz é criada aqui mesmo, no seu navegador.",
  hi: "नमस्ते। यह आवाज़ यहीं आपके ब्राउज़र में बनती है।",
};

/** How many voices show as chips at once; the rest sit under "More voices". */
export const CONSOLE_VOICES_SHOWN = 6;

/** Whisper language names (the model needs one named, or it translates to English). */
export const CONSOLE_LANGUAGES: readonly [value: string, label: string][] = [
  ["english", "English"], ["spanish", "Spanish"], ["french", "French"], ["german", "German"], ["italian", "Italian"],
  ["portuguese", "Portuguese"], ["dutch", "Dutch"], ["swedish", "Swedish"], ["norwegian", "Norwegian"], ["danish", "Danish"],
  ["finnish", "Finnish"], ["polish", "Polish"], ["turkish", "Turkish"], ["russian", "Russian"], ["ukrainian", "Ukrainian"],
  ["arabic", "Arabic"], ["hindi", "Hindi"], ["japanese", "Japanese"], ["korean", "Korean"], ["chinese", "Chinese"],
];

/** The longest text the console takes (21 Nov 2026: memory on phones); longer texts go to Studio's audiobook tool. */
export const CONSOLE_MAX_CHARS = 20_000;

export const CONSOLE_SAMPLE ="Welcome! This voice is being made right now, on your own phone or computer. Change this text to anything you like, pick a voice, and press Play. There is no account, no credit counter, and nothing to install.";

/** Short, use-case scripts so a first-time visitor can hear a realistic result in one click. */
export const CONSOLE_PRESETS: readonly { label: string; text: string }[] = [
  { label: "Narration", text: "The harbour woke slowly. Gulls called above the empty quay, and the first boat slipped out into the grey morning." },
  { label: "Advertisement", text: "Ready in ten seconds. Just type your script, pick a voice, and press play. No account, no credit counter, nothing to install." },
  { label: "Podcast", text: "Welcome back. Today: how a sentence can be rebuilt without recording the whole episode again. Let's listen to the result." },
  { label: "Character", text: "\"You came a long way for a story,\" the dragon said, folding its wings. \"Then let's make it worth the journey.\"" },
];

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
.vc-presets{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}.vc-presets button{appearance:none;font:inherit;font-size:.8rem;border:1px dashed var(--vc-line);background:none;color:var(--vc-muted);padding:5px 10px;border-radius:8px;cursor:pointer;min-height:44px}.vc-presets button:hover{border-color:var(--vc-accent);color:var(--vc-fg)}
.vc-voices{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}.vc-voices button{appearance:none;font:inherit;font-size:.86rem;border:1px solid var(--vc-line);background:none;color:var(--vc-fg);padding:6px 11px;border-radius:999px;cursor:pointer;min-height:44px}
.vc-voices button small{color:var(--vc-muted);margin-left:5px}.vc-voices button[aria-pressed=true]{border-color:var(--vc-accent);background:rgba(34,211,238,.12)}
.vc-more{flex-basis:100%}.vc-more summary{cursor:pointer;color:var(--vc-accent);font-size:.86rem;font-weight:600;padding:4px 2px}.vc-more .vc-voices{margin:4px 0 0}.vc-lang{margin:10px 2px 0;color:var(--vc-muted);font-size:.8rem;font-weight:600}
.vc-gpu{display:none;align-items:center;gap:6px;color:var(--vc-muted);font-size:.85rem;margin:10px 2px 0}.vc-gpu.on{display:flex}.vc-gpu input{accent-color:var(--vc-accent)}
.vc-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.vc-size{color:var(--vc-muted);font-size:.8rem}
.vc-long{color:var(--vc-muted);font-size:.8rem;margin:-6px 2px 12px}.vc-long a{color:var(--vc-accent)}.vc-pct{margin-top:2px}
.vc-pron textarea{min-height:64px;font-size:.9rem;margin-top:6px}.vc-hint{display:block;color:var(--vc-muted);font-size:.8rem;margin-top:6px}
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
export function voiceConsole(opts: { id?: string; first?: "tts" | "stt"; voiceSite: string; upsellTts?: string; upsellStt?: string; className?: string; persist?: boolean }): string {
  const id = opts.id ?? "vc";
  const first = opts.first ?? "tts";
  const v = (s: string) => `${id}-${s}`;
  const short = (x: ConsoleVoice) => CONSOLE_VOICE_LANGS.find((l) => l.lang === x.lang)!.short;
  const chip = (x: ConsoleVoice) => `<button type="button" data-voice="${esc(x.id)}"${x.lang.startsWith("en") ? "" : ` lang="${esc(x.lang)}"`} aria-pressed="${x === CONSOLE_VOICES[0]}" title="${esc(`${x.accent} ${x.gender}. Click to hear a sample.`)}">${esc(x.name)}<small>${esc(short(x))} ${esc(x.gender === "female" ? "F" : "M")}</small></button>`;
  const rest = CONSOLE_VOICES.slice(CONSOLE_VOICES_SHOWN);
  const groups = CONSOLE_VOICE_LANGS.map((g) => [g, rest.filter((x) => x.lang === g.lang)] as const).filter(([, list]) => list.length)
    .map(([g, list]) => `<p class="vc-lang">${esc(g.label)}</p><div class="vc-voices">${list.map(chip).join("")}</div>`).join("");
  const voices = CONSOLE_VOICES.slice(0, CONSOLE_VOICES_SHOWN).map(chip).join("")
    + `<details class="vc-more"><summary>${rest.length} more voices, ${CONSOLE_VOICE_LANGS.length} languages</summary>${groups}</details>`;
  const langs = CONSOLE_LANGUAGES.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
  return `<div class="vc${opts.className ? ` ${esc(opts.className)}` : ""}" id="${esc(id)}" data-first="${first}"${opts.persist ? ' data-persist="1"' : ""}>
<div class="vc-tabs" role="tablist" aria-label="Free voice tools"><button type="button" role="tab" id="${v("t-tts")}" aria-controls="${v("tts")}" aria-selected="${first === "tts"}">Text to speech</button><button type="button" role="tab" id="${v("t-stt")}" aria-controls="${v("stt")}" aria-selected="${first === "stt"}">Speech to text</button></div>
<div class="vc-pane" id="${v("tts")}" role="tabpanel" aria-labelledby="${v("t-tts")}"${first === "tts" ? "" : " hidden"}>
<label class="sr" for="${v("text")}" style="position:absolute;left:-9999px">Text to speak</label>
<textarea id="${v("text")}" spellcheck="true" maxlength="${CONSOLE_MAX_CHARS}">${esc(CONSOLE_SAMPLE)}</textarea>
<div class="vc-meta"><span id="${v("count")}"></span><span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to play</span></div>
<p class="vc-long">Longer than ${CONSOLE_MAX_CHARS.toLocaleString("en-US")} characters? <a href="${STUDIO_SITE}/audiobook">Make an audiobook in Studio</a>.</p>
<div class="vc-presets" role="group" aria-label="Try a sample script">${CONSOLE_PRESETS.map((p, i) => `<button type="button" data-preset="${i}">${esc(p.label)}</button>`).join("")}</div>
<div class="vc-voices" role="group" aria-label="Voice">${voices}</div>
<div class="vc-row"><button type="button" class="vc-go" id="${v("speak")}">&#9654; Play</button><span class="vc-size" id="${v("size")}">about 90 MB, once</span><button type="button" class="vc-sec" id="${v("stop")}" hidden>&#9632; Stop</button>
<label class="vc-speed">Speed <input type="range" id="${v("speed")}" min="0.6" max="1.6" step="0.1" value="1"><span id="${v("speedv")}">1.0x</span></label></div>
<label class="vc-gpu" id="${v("gpuw")}"><input type="checkbox" id="${v("gpu")}"> Graphics card mode (uses your GPU; a one-time 330 MB download instead of 90 MB)</label>
<details class="vc-fix vc-pron"><summary>Pronunciations</summary><label class="vc-hint" for="${v("pron")}">One per line: word = how to say it (whole words). Saved on this device.</label><textarea id="${v("pron")}" rows="3" spellcheck="false" placeholder="Glyphcall = glif call"></textarea></details>
<progress id="${v("tbar")}" max="1" hidden aria-label="Speech progress"></progress><p class="vc-status" id="${v("tstatus")}" role="status" aria-live="polite">First play fetches the voice once (about 90 MB); after that it is saved on this device.</p><p class="vc-status vc-pct" id="${v("tpct")}" aria-live="off"></p>
<div class="vc-out" id="${v("tout")}" hidden><audio id="${v("player")}" controls></audio><details class="vc-fix"><summary>Fix one sentence without redoing the rest</summary><ol id="${v("sents")}"></ol></details><div class="vc-row"><a class="vc-sec" id="${v("wav")}" download="glyphcall-speech.wav" href="#">Download WAV</a><button type="button" class="vc-sec" id="${v("mp3")}">Download MP3</button></div>${opts.upsellTts ? `<p class="vc-status">${opts.upsellTts}</p>` : ""}</div>
</div>
<div class="vc-pane" id="${v("stt")}" role="tabpanel" aria-labelledby="${v("t-stt")}"${first === "stt" ? "" : " hidden"}>
<label class="vc-drop" id="${v("drop")}"><input type="file" id="${v("file")}" accept="audio/*,video/*,.mp3,.m4a,.wav,.ogg,.opus,.webm,.mp4,.mov,.flac,.aac"><b>Drop a recording here, or click to choose one</b><span>MP3, M4A, WAV, OGG, WebM or a video. It stays on your computer.</span></label>
<div class="vc-opts"><button type="button" class="vc-sec vc-rec" id="${v("rec")}">&#9679; Record from the microphone</button><label>Spoken language <select id="${v("lang")}">${langs}</select></label></div>
<progress id="${v("sbar")}" max="1" hidden aria-label="Transcription progress"></progress><p class="vc-status" id="${v("sstatus")}" role="status" aria-live="polite">The first time, your browser fetches the listening model once; after that it starts straight away.</p>
<div class="vc-out" id="${v("sout")}" hidden><textarea id="${v("transcript")}" aria-label="Transcript" spellcheck="true"></textarea><div class="vc-row" style="margin-top:10px"><button type="button" class="vc-sec" id="${v("copy")}">Copy text</button><button type="button" class="vc-sec" data-fmt="txt">TXT</button><button type="button" class="vc-sec" data-fmt="srt">SRT subtitles</button><button type="button" class="vc-sec" data-fmt="vtt">VTT</button></div>${opts.upsellStt ? `<p class="vc-status">${opts.upsellStt}</p>` : ""}</div>
</div>
<div class="vc-foot"><span>No account</span><span>No credits or sign-up</span><span>Nothing uploaded</span><span>Free downloads</span></div>
<noscript><p class="vc-pane">This console needs JavaScript. The same tools: <a href="${esc(opts.voiceSite)}/text-to-speech">text to speech</a> and <a href="${esc(opts.voiceSite)}/transcribe">transcription</a>.</p></noscript>
</div>`;
}

// The web workers. Kept close to voice.glyphcall.com's tts-worker.js and stt-worker.js, with two changes: speech is
// posted sentence by sentence (so playback starts early) and a running job can be cancelled. 21 Nov 2026 (parity with
// voice.glyphcall.com): voices other than English are phonemized with the full espeak-ng (npm espeak-ng 1.0.2, about
// 18 MB, fetched from jsDelivr only when such a voice is used; the wasm is compiled once and every call gets a fresh
// instance), punctuation kept for pauses, then model.tokenizer and generate_from_ids; and an optional graphics-card
// mode (WebGPU, fp32) that falls back to the standard engine (wasm, q8). The worker is built from this string through a
// blob URL, so every import is an absolute URL.
const TTS_WORKER = `import { KokoroTTS, TextSplitterStream } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
const MODEL="onnx-community/Kokoro-82M-v1.0-ONNX",ESPEAK={e:"es",f:"fr-fr",i:"it",p:"pt-br",h:"hi"};
const ESPEAK_JS="https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.js",ESPEAK_WASM="https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.wasm";
let tts=null,loading=null,device="wasm",cancelled=0,esF=null,esM=null;
const progress=(p)=>{if(p&&p.status==="progress"&&p.total)self.postMessage({type:"download",file:p.file,loaded:p.loaded,total:p.total});};
function load(want){if(tts)return Promise.resolve(tts);if(!loading){device=want==="webgpu"?"webgpu":"wasm";const o=device==="webgpu"?{dtype:"fp32",device:"webgpu"}:{dtype:"q8",device:"wasm"};
loading=KokoroTTS.from_pretrained(MODEL,{...o,progress_callback:progress}).catch((err)=>{if(device!=="webgpu")throw err;device="wasm";self.postMessage({type:"note",message:"Graphics card mode is not available here; using the standard engine."});return KokoroTTS.from_pretrained(MODEL,{dtype:"q8",device:"wasm",progress_callback:progress});}).then((m)=>(tts=m)).catch((err)=>{loading=null;throw err;});}return loading;}
const toKokoro=(ps)=>ps.replace(/t\u0361?\u0283/g,"\u02a7").replace(/d\u0361?\u0292/g,"\u02a4").replace(/t\u0361s/g,"\u02a6").replace(/d\u0361z/g,"\u02a3").replace(/\u02b2/g,"j").replace(/\\s+/g," ").trim();
// A sentence ends at . ! ? or the danda, then closing quotes, then a space or the end; never at a period between digits
// ("3.5") or after a short capitalised abbreviation ("Dr.", "Sra."). Long sentences are cut at a comma or space.
function sentences(text){const out=[];for(const para of text.split(/\\n+/)){let s="";const push=()=>{s=s.trim();while(s.length>400){const cut=Math.max(s.lastIndexOf(",",400),s.lastIndexOf(" ",400),200);out.push(s.slice(0,cut+1).trim());s=s.slice(cut+1).trim();}if(s)out.push(s);s="";};
for(let i=0;i<para.length;i++){const ch=para[i];s+=ch;if(!/[.!?\u0964]/.test(ch))continue;while(i+1<para.length&&/[.!?\u0964"'\u00bb)\\]]/.test(para[i+1]))s+=para[++i];if(i+1<para.length&&!/\\s/.test(para[i+1]))continue;
if(ch==="."&&/(?:^|[\\s(])[A-Z\u00c0-\u00de][a-z\u00e0-\u00ff]{0,3}\\.$/.test(s))continue;push();}push();}return out;}
async function espeakIpa(text,lang){if(!esF){self.postMessage({type:"note",message:"Fetching the pronunciation dictionary for this language (first time only)..."});const [mod,bytes]=await Promise.all([import(ESPEAK_JS),fetch(ESPEAK_WASM).then((r)=>r.arrayBuffer())]);esM=await WebAssembly.compile(bytes);esF=mod.default;}
const es=await esF({arguments:["--phonout","out","-q","--ipa","-v",lang,text],instantiateWasm:(imports,ok)=>{WebAssembly.instantiate(esM,imports).then((inst)=>ok(inst));return {};},print:()=>{},printErr:()=>{}});
return es.FS.readFile("out",{encoding:"utf8"}).replace(/\\s+/g," ").trim();}
const PUNCT=/([,.;:!?\u00a1\u00bf\u0964\u2014\u2026"\u00ab\u00bb()]+)/,ONLY=/^[,.;:!?\u00a1\u00bf\u0964\u2014\u2026"\u00ab\u00bb()]+$/;
async function phonemizeOther(s,lang){let out="";for(const p of s.split(PUNCT)){if(!p)continue;if(ONLY.test(p)){out+=p.replace(/[\u00ab\u00bb()"]/g,"").replace(/[\u00a1\u00bf]/g,"").replace(/\u0964/g,".")+" ";continue;}if(p.trim())out+=(await espeakIpa(p.trim(),lang))+" ";}return out.replace(/\\s+([,.;:!?])/g,"$1").trim();}
async function* speakOther(model,text,voice,speed,id){const lang=ESPEAK[voice[0]];for(const s of sentences(text)){if(cancelled===id)return;const ps=toKokoro(await phonemizeOther(s,lang));if(!ps)continue;const {input_ids}=model.tokenizer(ps,{truncation:true});const audio=await model.generate_from_ids(input_ids,{voice,speed});yield {text:s,audio};}}
async function* speakEnglish(model,text,voice,speed){const sp=new TextSplitterStream();sp.push(text);sp.close();for await(const piece of model.stream(sp,{voice,speed}))yield piece;}
self.onmessage=async(e)=>{const m=e.data;if(m.type==="cancel"){cancelled=m.id;return;}
try{const model=await load(m.device);self.postMessage({type:"ready",id:m.id,device});if(m.type!=="speak")return;
// Paragraph by paragraph (a blank line). Each sentence is posted as soon as it is made; after every paragraph but the
// last a "para" message tells the page to leave a longer pause there.
async function* speakAll(model,text,voice,speed,id){const paras=text.split(/\\n\\s*\\n/).map((p)=>p.trim()).filter(Boolean);
for(let k=0;k<paras.length;k++){const g=ESPEAK[voice[0]]?speakOther(model,paras[k],voice,speed,id):speakEnglish(model,paras[k],voice,speed);
for await(const piece of g)yield piece;if(k<paras.length-1)yield {paraEnd:true};}}
const gen=speakAll(model,m.text,m.voice,m.speed,m.id);let done=0;
for await(const piece of gen){if(cancelled===m.id)return;if(piece.paraEnd){self.postMessage({type:"para",id:m.id});continue;}const a=piece.audio;done+=(piece.text||"").length;const pcm=a.audio;self.postMessage({type:"chunk",id:m.id,pcm,text:piece.text||"",rate:a.sampling_rate,done,total:m.text.length},[pcm.buffer]);}
self.postMessage({type:"end",id:m.id});}catch(err){self.postMessage({type:"error",id:m.id,message:String((err&&err.message)||err)});}};`;

const STT_WORKER = `import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";
const RATE=16000,BLOCK=90*RATE;let asr=null,loading=null,gpu=false;
const progress=(p)=>{if(p&&p.status==="progress"&&p.total)self.postMessage({type:"download",file:p.file,loaded:p.loaded,total:p.total});};
// The 8-bit CPU build only: the graphics build of the same model fetched over 270 MB on 16 Nov, too much for a first try.
function load(){if(asr)return Promise.resolve(asr);if(!loading)loading=pipeline("automatic-speech-recognition","onnx-community/whisper-base",{device:"wasm",dtype:"q8",progress_callback:progress}).then((m)=>(asr=m)).catch((err)=>{loading=null;throw err;});return loading;}
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
const TTS_SRC=${JSON.stringify(TTS_WORKER)},STT_SRC=${JSON.stringify(STT_WORKER)},HELLO=${voices.replace(/</g, "\\u003c")},SAMPLES=${JSON.stringify(CONSOLE_SAMPLES).replace(/</g, "\\u003c")},SAMPLE0=${JSON.stringify(CONSOLE_SAMPLE)},LANG_OF=${JSON.stringify(Object.fromEntries(CONSOLE_VOICES.map((x) => [x.id, x.lang])))},MAX=${CONSOLE_MAX_CHARS},SAMPLE_BASE=${JSON.stringify(`${VOICE_SITE}/samples/`)},PRESETS=${JSON.stringify(CONSOLE_PRESETS.map((p) => p.text)).replace(/</g, "\u003c")};
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
const saved=store.get("gc-vc-text");if(saved)text.value=saved.slice(0,MAX);
const upd=()=>{count.textContent=text.value.length.toLocaleString()+" characters (up to "+MAX.toLocaleString()+")";};upd();
// Storage writes wait until typing pauses (they were made on every keystroke).
const later=(fn,ms)=>{let t=0;return()=>{clearTimeout(t);t=setTimeout(fn,ms);};};const saveText=later(()=>store.set("gc-vc-text",text.value),600);
text.addEventListener("input",()=>{upd();saveText();});
root.querySelectorAll("[data-preset]").forEach((b)=>b.addEventListener("click",()=>{const p=PRESETS[Number(b.dataset.preset)];if(!p)return;text.value=p;upd();saveText();text.focus();}));
// Pronunciations: "word = how to say it", whole words, case-insensitive (as voice.glyphcall.com's tts.js).
const pron=$("pron");pron.value=store.get("gc-vc-pron")||"";pron.addEventListener("input",later(()=>store.set("gc-vc-pron",pron.value),600));
const respell=(t)=>{for(const line of pron.value.split("\\n")){const i=line.indexOf("=");if(i<1)continue;const w=line.slice(0,i).trim(),sy=line.slice(i+1).trim();if(!w||!sy)continue;const e=w.replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\$&");t=t.replace(new RegExp("(^|[^\\\\p{L}\\\\p{N}])"+e+"(?=$|[^\\\\p{L}\\\\p{N}])","giu"),(m,pre)=>pre+sy);}return t;};
speed.oninput=()=>{$("speedv").textContent=Number(speed.value).toFixed(1)+"x";};
// Graphics card mode (WebGPU), offered only where the browser has it; the engine is chosen when the voice loads.
const gpuw=$("gpuw"),gpu=navigator.gpu?$("gpu"):null;if(gpu){gpuw.classList.add("on");gpu.checked=store.get("gc-vc-gpu")==="1";gpu.onchange=()=>{store.set("gc-vc-gpu",gpu.checked?"1":"0");if(tw&&!speak.disabled){tw.terminate();tw=null;ready=false;}};}
let voice=store.get("gc-vc-voice")||"af_heart";const chips=root.querySelectorAll("[data-voice]");
const mark=()=>chips.forEach((c)=>c.setAttribute("aria-pressed",String(c.dataset.voice===voice)));if(![...chips].some((c)=>c.dataset.voice===voice))voice="af_heart";mark();
// mode: "main" builds the result sentence by sentence, "redo" replaces one sentence of it, "preview" only plays.
let tw=null,ready=false,job=0,ctx=null,next=0,sents=[],mode="main",redoAt=-1,redoBuf=[],redoText="",rate=24000,last=null,t0=0,first=0;const tdl=dl();
const sentList=$("sents"),attr=(s)=>s.replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
// Pauses: 0.12 s between sentences, 0.5 s after a paragraph (a blank line in the text).
const GAP=0.12,PARA=0.5;
const flat=()=>{const out=[];for(const s of sents){for(const p of s.pcm)out.push(p);out.push(new Float32Array(Math.round(rate*(s.para?PARA:GAP))));}return out;};
function listSents(){sentList.innerHTML=sents.map((s,i)=>'<li><div><input aria-label="Sentence '+(i+1)+'" value="'+attr(s.text.trim())+'"><button type="button" class="vc-sec" data-redo="'+i+'">Redo</button></div></li>').join("");}
sentList.addEventListener("click",(e)=>{const b=e.target.closest("[data-redo]");if(!b||speak.disabled)return;const i=Number(b.dataset.redo),t=b.previousElementSibling.value.trim();if(t)redoOne(i,t);});
sentList.addEventListener("keydown",(e)=>{if(e.key==="Enter"&&e.target.tagName==="INPUT"){e.preventDefault();e.target.nextElementSibling.click();}});
function tworker(){if(tw)return tw;tw=mk(TTS_SRC);tw.onmessage=(e)=>{const m=e.data;
if(m.type==="download"){const {l,t}=tdl(m);tbar.hidden=false;tbar.value=t?l/t:0;say(tst,"Fetching the voice (first time only): "+mb(l)+" of "+mb(t)+" MB");}
else if(m.type==="note"){say(tst,m.message);}
else if(m.type==="ready"){if(gpu&&m.device!=="webgpu")gpu.checked=false;if(!ready){ready=true;tbar.hidden=true;$("size").hidden=true;
// The installed app asks the browser to keep the saved model (it may still say no); other pages leave it to the browser.
if(root.dataset.persist&&navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
if(!busy())say(tst,"Voice ready. Press Play to hear your text.","ok");}}
else if(m.type==="para"&&m.id===job){if(mode==="main"&&sents.length)sents[sents.length-1].para=true;if(ctx)next+=PARA-GAP;}
else if(m.type==="chunk"&&m.id===job){rate=m.rate;if(mode==="main")sents.push({text:m.text,pcm:[m.pcm]});else if(mode==="redo")redoBuf.push(m.pcm);
if(ctx){const b=ctx.createBuffer(1,m.pcm.length,rate);b.copyToChannel(m.pcm,0);const s=ctx.createBufferSource();s.buffer=b;s.playbackRate.value=1;s.connect(ctx.destination);next=Math.max(next,ctx.currentTime+0.05);s.start(next);next+=b.duration+GAP;}
// The running percentage goes to a line screen readers do not announce; the status line keeps the milestones.
if(!first){first=performance.now();say(tst,"Speaking while the rest is made.");}tbar.hidden=false;tbar.value=Math.min(1,m.done/m.total);pct.textContent=Math.round(100*Math.min(1,m.done/m.total))+"% made";}
else if(m.type==="end"&&m.id===job){pct.textContent="";finish();}
else if(m.type==="error"){fail("That did not work: "+m.message+".");}};
tw.onerror=(e)=>{fail("The voice could not be loaded"+(e.message?": "+e.message:"")+". Check your connection.");};return tw;}
// A failed load or run drops the worker, so the next Play starts a fresh one (the worker also forgets a failed load).
const pct=$("tpct");
function fail(msg){if(tw){tw.terminate();tw=null;}ready=false;mode="main";tbar.hidden=true;pct.textContent="";speak.disabled=false;stop.hidden=true;say(tst,msg+" Press Play to try again.","err");}
const busy=()=>speak.disabled;
const dev=()=>gpu&&gpu.checked?"webgpu":"wasm";
function warm(){if(!tw){tworker().postMessage({type:"load",id:0,device:dev()});if(!ready)say(tst,"Fetching the voice (first time only)...");}}
function finish(cancelled){speak.disabled=false;stop.hidden=true;tbar.hidden=true;const was=mode;mode="main";
if(was==="preview"){if(!cancelled)say(tst,"That was "+preview+". Press Play to hear your own text in this voice.","ok");return;}
if(was==="redo"){const ok=!cancelled&&redoBuf.length;if(ok){sents[redoAt].pcm=redoBuf;sents[redoAt].text=redoText;}redoBuf=[];if(!ok)return;}
if(!sents.length)return;const audio=flat();
last={parts:audio,rate};const blob=toWav(audio,rate);if(wav.href.startsWith("blob:"))URL.revokeObjectURL(wav.href);const url=URL.createObjectURL(blob);wav.href=url;player.src=url;tout.hidden=false;listSents();
let secs=0;for(const p of audio)secs+=p.length;say(tst,was==="redo"?"Sentence "+(redoAt+1)+" redone; the download has the new take.":"Done: "+(secs/rate).toFixed(1)+" seconds of audio. Edit the text and press Play to make it again, or fix one sentence below. Free.","ok");}
let preview="";
function redoOne(i,t){mode="redo";redoAt=i;redoBuf=[];redoText=t;run(respell(t),voice);}
function go(str,v,who){if(!(str||"").trim()){say(tst,"Type something to hear first.","err");text.focus();return;}preview=who||"";mode=who?"preview":"main";if(!who)sents=[];run(who?str:respell(str),v);}
function run(str,v){const s=str.trim();
const C=window.AudioContext||window.webkitAudioContext;if(ctx)ctx.close().catch(()=>{});ctx=C?new C():null;next=0;first=0;t0=performance.now();
job++;speak.disabled=true;stop.hidden=false;tbar.hidden=false;tbar.removeAttribute("value");if(ready)say(tst,"Making the first sentence...");else say(tst,"Fetching the voice (first time only)...");
tworker().postMessage({type:"speak",id:job,text:s,voice:v||voice,speed:Number(speed.value),device:dev()});}
speak.onclick=()=>go(text.value);
stop.onclick=()=>{const j=job;job++;if(tw)tw.postMessage({type:"cancel",id:j});if(ctx){ctx.close().catch(()=>{});ctx=null;}finish(mode!=="main");say(tst,"Stopped. Press Play to start again.");};
text.addEventListener("keydown",(e)=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();if(!speak.disabled)go(text.value);}});
// A chip plays the voice's recorded sample from voice.glyphcall.com/samples/ at once, through one reused audio element
// (a plain play, before and without the 90 MB voice); a voice without a clip simply stays silent. Play still makes the
// visitor's own text.
const clip=new Audio();clip.preload="none";clip.onerror=()=>{};
chips.forEach((c)=>c.onclick=()=>{voice=c.dataset.voice;store.set("gc-vc-voice",voice);mark();
const sm=SAMPLES[LANG_OF[voice]];if(sm&&(text.value===SAMPLE0||Object.values(SAMPLES).includes(text.value))){text.value=sm;upd();}
try{clip.pause();clip.src=SAMPLE_BASE+encodeURIComponent(voice)+".mp3";const p=clip.play();if(p&&p.catch)p.catch(()=>{});}catch{}});
// Warm-up (fetching the ~90 MB voice ahead of Play) starts on the first keystroke, not on focus, and never on a
// metered or slow connection (Save-Data, or anything below 4G): there the download waits for Play.
const thrifty=()=>{const c=navigator.connection;return !!c&&(!!c.saveData||(!!c.effectiveType&&c.effectiveType!=="4g"));};
text.addEventListener("input",()=>{if(!thrifty())warm();},{once:true});
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
if(/^text\\//.test(f.type)||/\\.(txt|md)$/i.test(f.name)){f.text().then((s)=>{show("tts");text.value=s.slice(0,MAX);upd();saveText();say(tst,s.length>MAX?"Loaded the first "+MAX.toLocaleString()+" characters of "+f.name+"; Studio takes longer texts.":"Loaded "+f.name+". Press Play.",s.length>MAX?"err":"ok");});return;}take(f);});
if(navigator.mediaDevices&&window.MediaRecorder){let r=null,chunks=[],tick=0,began=0;rec.onclick=async()=>{if(r&&r.state==="recording"){r.stop();return;}
try{const st=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];r=new MediaRecorder(st);r.ondataavailable=(e)=>{if(e.data.size)chunks.push(e.data);};
r.onstop=()=>{clearInterval(tick);st.getTracks().forEach((t)=>t.stop());rec.classList.remove("on");rec.textContent="\\u25CF Record again";const type=r.mimeType||"audio/webm";take(new File(chunks,"recording."+(type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm"),{type}));};
r.start(1000);began=Date.now();rec.classList.add("on");rec.textContent="\\u25A0 Stop and transcribe";tick=setInterval(()=>{const s=Math.round((Date.now()-began)/1000);say(sst,"Recording "+Math.floor(s/60)+":"+String(s%60).padStart(2,"0")+". Press Stop when you are done.");},500);}
catch(err){say(sst,"The microphone could not be used: "+(err&&err.message?err.message:err)+". Allow microphone access for this site and try again.","err");}};}else rec.hidden=true;
$("copy").onclick=async(e)=>{const b=e.currentTarget;try{await navigator.clipboard.writeText(tr.value);b.textContent="Copied";}catch{tr.select();document.execCommand("copy");b.textContent="Copied";}setTimeout(()=>{b.textContent="Copy text";},1800);};
root.querySelectorAll("[data-fmt]").forEach((b)=>b.onclick=()=>{const k=b.dataset.fmt;if(!segs.length&&!tr.value)return;const body=k==="txt"?tr.value:fmt[k](segs);save(new Blob([body],{type:k==="vtt"?"text/vtt":"text/plain"}),base+"."+k);});
});})();</script>`;
}
