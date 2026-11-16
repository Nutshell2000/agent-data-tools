# OpenAI is shutting down tts-1: what breaks and how to move

*Facts checked 16 November 2026. Rival figures come from each rival's own page, linked in the table.*

## What is being retired, and when

OpenAI's [deprecations page](https://developers.openai.com/api/docs/deprecations) lists `tts-1`, `tts-1-hd` and
`gpt-4o-mini-tts` (with its dated snapshots) as deprecated, with shutdown on **6 January 2027** (notice date 1 October
2026). The replacement it names is `gpt-realtime-2.1-mini`, a Realtime API model, not another model for
`POST /v1/audio/speech`.

## What breaks

Anything that sends `model: "tts-1"` to OpenAI's `/v1/audio/speech` after that date: Home Assistant speech
integrations, Obsidian and browser read-aloud plugins, Open WebUI, scripts that make MP3 files. Apps with an
"OpenAI-compatible endpoint" setting keep working if you give them another base URL that speaks the same request.

## Moving to Glyphcall

Change the base URL and the key. The request stays the same.

```python
from openai import OpenAI
client = OpenAI(base_url="https://glyphcall.com/v1", api_key="adt_...")   # key: https://glyphcall.com/credits (from $1)
with client.audio.speech.with_streaming_response.create(model="tts-1", voice="nova", input="Hello from the new endpoint.") as r:
    r.stream_to_file("hello.mp3")
```

```bash
curl https://glyphcall.com/v1/audio/speech -H "Authorization: Bearer adt_..." -H "Content-Type: application/json" \
  -d '{"model":"tts-1","voice":"nova","input":"Hello from the new endpoint."}' --output hello.mp3
```

Home Assistant-style settings: API URL `https://glyphcall.com/v1` (or the full `https://glyphcall.com/v1/audio/speech`
where the app asks for the endpoint), API key `adt_...`, model `tts-1`, voice from `GET https://glyphcall.com/v1/audio/voices`
(free, no key; it fills the voice picker of apps that read it).

What you get, exactly:

- **Model:** Deepgram Aura-2 on Cloudflare Workers AI. `tts-1` is accepted as a name only; this is not OpenAI's model
  and these are not OpenAI's voices. OpenAI voice names (alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer)
  are mapped to Aura-2 voices; the `X-Voice` response header names the voice that spoke.
- **Limits:** up to 2,000 characters per request, one MP3 file back. English (40 voices) by default, Spanish
  (10 voices) with `"language": "es"`.
- **Price with a prepaid key:** 4 credits ($0.004) per started 100 characters, never more than $0.01 up to 300
  characters or $0.08 up to 2,000. The `X-Credits-Charged` header states it. Failed calls are not charged.
- **Price per call without a key (x402 or MPP, USDC):** $0.01 up to 300 characters, $0.08 up to 2,000.
- **Free test key:** `POST https://glyphcall.com/keys/voice-test` gives 25 calls (speech up to 100 characters, audio up
  to 30 seconds) when the offer is on; if it answers 404 the offer is off and a $1 key is the way in.
- **Errors** come in OpenAI's shape, `{"error": {"message", "type", "code"}}`, and the message is a sentence.

What we do **not** support: `response_format` other than `mp3` (no opus, aac, flac, wav, pcm), `speed` other than 1,
`instructions`, a separate HD tier (`tts-1-hd` is accepted and gives the same voices), streaming of partial audio,
realtime speech, voice cloning, and languages other than English and Spanish on this route.

## Options, honestly

| Option | What it is | Price (their page, 16 Nov 2026) | Limits | OpenAI-compatible | Better than us when |
|---|---|---|---|---|---|
| Self-hosted Kokoro ([Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)) | Open Kokoro-82M model in a Docker image you run (CPU or GPU) | Free software; you pay for the machine | 8 languages; mp3, wav, opus, flac, aac, pcm | Yes: `/v1/audio/speech` and `/v1/audio/voices` on your own host | You have a machine that is always on, want audio to stay at home, or need a format or language we lack |
| [Lemonfox](https://www.lemonfox.ai/apis/text-to-speech) | Hosted speech API | $2.50 per 1,000,000 characters; $5 a month includes 2 million; first month free ([pricing](https://www.lemonfox.ai/)) | 8 languages, 50+ voices; mp3, opus, aac, flac, pcm, ogg, wav | Yes (OpenAI and ElevenLabs shapes) | Almost always on price: about a sixteenth of ours per character. Also more formats and languages |
| [Together](https://www.together.ai/pricing) | Hosted open models | Kokoro-82M $4.00 per 1M characters; Orpheus $15.00; Cartesia Sonic-3 $65.00 | 8 languages, 54 voices for Kokoro ([model page](https://www.together.ai/models/kokoro-82m)); other limits: see their docs | OpenAI-style API; check their docs for the speech path | On price (a tenth of ours with Kokoro), and if you already buy other models there |
| [Groq](https://console.groq.com/docs/text-to-speech) | Hosted Orpheus speech (English, Saudi Arabic) | See their pricing page | Default output is WAV | Yes: `https://api.groq.com/openai/v1/audio/speech` | You already use Groq and want expressive Orpheus voices |
| Glyphcall (us) | Aura-2 behind OpenAI's and ElevenLabs' request shapes | $0.004 per started 100 characters with a key ($40 per 1M); $0.01 / $0.08 per call without | 2,000 characters, MP3, English and Spanish | Yes for the request above; see the list of what is missing | You want no account and no subscription (a $1 key or pay per call), small or irregular volume, or the same key for transcription and about 700 other tools |

We are not the low-price option for speech: Lemonfox and Together's Kokoro cost far less per character. OpenAI's own
current prices: see its [pricing page](https://developers.openai.com/api/docs/pricing).
