# Files for the voice website (voice.glyphcall.com)

The voice site is a separate Pages project; its files are not in this repository. These are changes and pages for it.

| File | What it is |
|---|---|
| `transcribe-trial.patch` | Unified diff against the live `https://voice.glyphcall.com/transcribe.js` (one plain GET on 16 Nov 2026; the header holds the file's SHA-256). Adds the "Try Pro free on this file" button. |
| `openai-tts-1-shutdown-migration.md` | Guide to publish: OpenAI's tts-1 shutdown (6 Jan 2027) and how to move. |
| `openai-whisper-1-shutdown-migration.md` | Guide to publish: OpenAI's whisper-1 shutdown (26 Feb 2027) and how to move. |

## The patch

What it changes in `transcribe.js`:

- `callApi(path, blob, lang, key)` takes the key to use (default: the Pro key) and carries the API's own sentence in
  `PayError` when the API refuses (401, 402, 403).
- The body of the "Transcribe with Pro" handler becomes `serverRun(btn, key, trial)`; the Pro button calls it as before.
- A button `#trygo` ("Try Pro free on this file") is created next to `#fastgo`, so the page HTML needs no change. On
  click it POSTs `/credits/trial`, keeps the returned key in a variable (never in `localStorage`), and runs the chosen
  file through the same server path as Pro, without the summary. A recording over 30 minutes is refused in the browser
  before anything is sent. Refusals from the API (trial off, file of the day used, the day's minutes used up, too long)
  are shown as the API words them, each with the way to Pro.

Apply, in the voice site's repository, where `transcribe.js` lives:

```
patch -p1 --dry-run < transcribe-trial.patch && patch -p1 < transcribe-trial.patch
```

If the live file has changed since 16 Nov 2026 the dry run says so; compare with the SHA-256 in the patch header.
The patch was checked for syntax (`node --check`) and applies cleanly to the fetched file. It was **not** run in a
browser.

## Worker settings that must be on first

Both settings below are off everywhere since 21 Nov 2026 (a free user must cost nothing metered, and a trial file
or a test key runs a transcription or speech model). Do not install `transcribe-trial.patch` while `CREDITS_TRIAL`
is off: the button would only show the refusal.

- `CREDITS_TRIAL` = `"on"` (wrangler var). It is `"off"` in `wrangler.jsonc` (production) and in
  `wrangler.staging.jsonc`. While it is off, `POST /credits/trial` answers 404 with a sentence and the button shows it.
- `CREDITS_TRIAL_MINUTES` (default 200): audio minutes all trials together may use per UTC day.
- The two migration guides no longer mention `POST /keys/voice-test` (`VOICE_TEST_KEYS` is off): they name the
  paid key only.
- The live script calls `https://agent-data-tools.revmesh2074.workers.dev`; the Worker allows any origin (CORS `*`).

## Test on staging

1. Deploy the Worker to staging (both vars are on there). Check `curl -X POST <staging>/credits/trial`: a key
   `adt_tr_...`, `limits`, `expires` within 2 hours.
2. Serve the patched site locally with `const API` pointed at staging. Choose a short MP3: the button transcribes it
   and the status ends with "That was today's free Pro file."
3. Click again with another file: the status shows "Today's free trial file for this network address has been used...".
4. Choose a recording over 30 minutes: refused in the browser, nothing sent.
5. Reload the page: no key in `localStorage` other than `gv-key` (the Pro key, as before).
6. With a real MP3 of a few minutes, check the response headers of the upload: `X-Credits-Charged: 0`,
   `X-Trial-Minutes`. This is also the first proof with real Whisper; the repository's tests use a fake model.
