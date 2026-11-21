# OpenAI is shutting down whisper-1: what breaks and how to move

*Facts checked 16 November 2026. Rival figures come from each rival's own page, linked in the table.*

## What is being retired, and when

OpenAI's [deprecations page](https://developers.openai.com/api/docs/deprecations) lists `whisper-1`,
`gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and `gpt-4o-transcribe-diarize` as deprecated, with shutdown on
**26 February 2027** (notice date 26 August 2026). The replacements it names are `gpt-transcribe` and
`gpt-live-transcribe`. The same page retires the `/v1/audio/translations` endpoint on the same day.

## What breaks

Anything that sends `model: "whisper-1"` to OpenAI's `/v1/audio/transcriptions` after that date: subtitle scripts,
meeting-note tools, Home Assistant speech-to-text integrations, Obsidian and Open WebUI transcription settings. The
open Whisper model itself is not affected; only OpenAI's hosted `whisper-1` goes away.

## Moving to Glyphcall

Change the base URL and the key. The request stays the same.

```python
from openai import OpenAI
client = OpenAI(base_url="https://glyphcall.com/v1", api_key="adt_...")   # key: https://glyphcall.com/credits (from $1)
with open("meeting.mp3", "rb") as f:
    srt = client.audio.transcriptions.create(model="whisper-1", file=f, response_format="srt")
```

```bash
curl https://glyphcall.com/v1/audio/transcriptions -H "Authorization: Bearer adt_..." \
  -F file=@meeting.mp3 -F model=whisper-1 -F response_format=verbose_json
```

Home Assistant-style settings: API URL `https://glyphcall.com/v1`, API key `adt_...`, model `whisper-1`.

What you get, exactly:

- **Model:** Whisper large-v3-turbo (the open model) on Cloudflare Workers AI, 90+ languages. `whisper-1` is accepted
  as a name only; this is not OpenAI's hosted model. `GET https://glyphcall.com/v1/models` (free, no key) says so.
- **Formats back:** `json`, `text`, `srt`, `vtt`, `verbose_json` (segments and words with timings). `language` is
  optional.
- **Limits:** any common audio or video format up to 5 MB; MP3 or WAV up to 25 MB and 60 minutes.
- **Price with a prepaid key:** audio of 30 seconds or less costs 1 credit ($0.001); a longer file up to 5 MB costs
  $0.01; an MP3 or WAV over 5 MB (up to 60 minutes) costs $0.05. MP3 and WAV are measured before the charge; other
  formats are charged $0.01 and the difference is given back when the model reports 30 seconds or less. The
  `X-Credits-Charged` header states what was charged. Failed calls are not charged.
- **Price per call without a key (x402 or MPP, USDC):** $0.01 per file up to 5 MB, $0.05 for a longer MP3 or WAV.
- **No free test key:** every transcription runs a paid model, so the way in is a prepaid key from $1 at
  `https://glyphcall.com/credits` (no account), or one call paid on its own with x402.
- **Errors** come in OpenAI's shape, `{"error": {"message", "type", "code"}}`, and the message is a sentence.

What we do **not** support: `/v1/audio/translations`, speaker labels (diarization) on this route, `prompt`,
`temperature` and `timestamp_granularities` (they are ignored; `verbose_json` always carries segments and words),
streaming or live transcription, files over 25 MB or 60 minutes in one request, and files over 5 MB that are not MP3
or WAV.

## Options, honestly

| Option | What it is | Price (their page, 16 Nov 2026) | Limits | OpenAI-compatible | Better than us when |
|---|---|---|---|---|---|
| Self-hosted | Kokoro is text to speech only and does not transcribe. For transcription at home, the open [Whisper](https://github.com/openai/whisper) weights run locally (its `turbo` model needs about 6 GB of VRAM) | Free software; you pay for the machine | Your hardware; `turbo` is not trained for translation | Only with a server in front that speaks the OpenAI request | Audio must not leave your network, or volume is high and a GPU is already there |
| [Groq](https://console.groq.com/docs/speech-to-text) | Hosted Whisper | whisper-large-v3-turbo $0.04 per hour, whisper-large-v3 $0.111 per hour; at least 10 seconds billed per request | 25 MB (free tier), 100 MB (developer tier); answers json, verbose_json, text | Yes | Most of the time on price: billed by length, so short and medium files cost far less than our per-file price. Larger files too |
| [Together](https://www.together.ai/pricing) | Hosted Whisper large-v3 and others | $0.0015 per audio minute ($0.09 an hour); streaming $0.0035 per minute | See their docs | OpenAI-style API | Files of a few minutes (billed by the minute), streaming, or you already buy other models there |
| [Lemonfox](https://www.lemonfox.ai/apis/speech-to-text) | Hosted Whisper API | $0.50 per 3 hours; $5 a month includes 30 hours; first month free ([pricing](https://www.lemonfox.ai/)) | Upload 100 MB, by URL 1 GB; json, text, srt, verbose_json, vtt; speaker labels | Yes | Large files, speaker labels, translation to English, EU-only processing (20% more) |
| Glyphcall (us) | Whisper large-v3-turbo behind OpenAI's and ElevenLabs' request shapes | $0.001 up to 30 seconds with a key; $0.01 per file up to 5 MB; $0.05 per MP3 or WAV up to 60 minutes | 25 MB, 60 minutes | Yes for the request above; see the list of what is missing | You want no account and no subscription (a $1 key or pay per call), SRT or VTT straight from the request, hour-long MP3s (at full length $0.05 an hour), or the same key for speech and about 700 other tools |

Our price is per file, not per minute. A 5-minute file costs $0.01 here and about a third of a cent at Groq; a
60-minute MP3 costs $0.05 here, $0.04 at Groq, $0.09 at Together and about $0.17 at Lemonfox. OpenAI's own current
prices: see its [pricing page](https://developers.openai.com/api/docs/pricing).
