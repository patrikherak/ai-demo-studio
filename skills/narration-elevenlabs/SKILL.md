---
name: narration-elevenlabs
description: Generate demo-video narration with ElevenLabs text-to-speech — choose a voice by accent and use case, pick a model, estimate cost, synthesize one measured audio file per segment with caching, optional word timing and subtitles. Use after the storyboard is written and before recording (audio-first).
---

# Narration with ElevenLabs

Goal: `work/<slug>/audio/<segment>.mp3` for every segment and `audio/manifest.json` with measured
durations. Narration is produced **before** recording so every scene can be recorded exactly as
long as its voice-over (audio-first).

## Setup

`.env` needs `ELEVENLABS_API_KEY`. `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID` are defaults
that `narration.json` can override. Never print the key.

Without an ElevenLabs key the run does not stop: `narrate.mjs` uses OpenAI (`gpt-4o-mini-tts`,
set `"openai": { "voice": "coral", "instructions": "…" }` in `narration.json` for the style) or,
offline, macOS `say`. `--provider` or `"provider"` forces one. The manifest records which one
was used; say so in the report.

Every segment is mastered after generation (edge silence trimmed, -18 LUFS), so segments from
different takes match. Word timing comes from ElevenLabs itself or, for the other providers,
from OpenAI's transcription API; `fit-scenes.mjs` turns it into sentence and word cues.

## 1. Choose the voice

```bash
node scripts/voices.mjs --use-case narration
node scripts/voices.mjs --accent american --gender female
node scripts/voices.mjs --search calm --json
```

Language is not accent: an English voice may be British or American. Pick by the labels
(accent, age, use case, description) against the brief, listen to `previewUrl` if in doubt, and
write the chosen name, id and why into `brief.md`. Keep one voice for the whole video.

## 2. Choose the model

| Model | Use |
|---|---|
| `eleven_multilingual_v2` | default; most natural long-form narration, many languages |
| `eleven_turbo_v2_5` / `eleven_flash_v2_5` | faster and cheaper; supports `languageCode` to force a language |
| newer models on your account | fine if the voice supports them; re-check pronunciation |

`voiceSettings` in `narration.json` override the `.env` defaults: `stability` (0.4–0.6 for
narration), `similarity_boost` (~0.75), `style` (0 for neutral), `speed` (0.9–1.1).

## 3. Estimate, then generate

```bash
node scripts/narrate.mjs work/<slug>/narration.json --dry-run
node scripts/narrate.mjs work/<slug>/narration.json            # add --timestamps for subtitles
```

- The script sends each segment with its neighbours as context (`previous_text`/`next_text`), so
  intonation flows across segments.
- Results are cached by a hash of voice, model, settings and text: re-running only generates
  segments that changed. `--force` regenerates everything (costs credits).
- `--timestamps` saves character timings (`<id>.alignment.json`) and per-segment subtitles
  (`<id>.srt`, times relative to the segment start).

## 4. Listen and check

Listen to every file (or at least the first and last second of each) before recording:
mispronounced names, numbers read wrongly, clipped endings, unnatural pauses. Fix the text, not
the audio: spell things phonetically, rephrase, split long sentences, add a comma for a pause.
Re-run; only changed segments are regenerated.

Verify completeness: the concatenated segment texts equal the approved script (same sentences,
no omissions or duplicates).

## 5. Hand over to recording

```bash
node scripts/fit-scenes.mjs work/<slug>/audio/manifest.json work/<slug>/scenes/*.json
```

Each scene lists its segment ids in `"narration"`. The script writes `minDurationMs` (lead-in +
narration + gaps + reserve) and an `"audio"` timeline into every scene. Record afterwards.

## Pitfalls

- A 429 or 5xx is retried automatically; a 401 means a wrong key, a 422 usually an unknown voice
  or a model the voice does not support.
- Do not stretch or speed up audio in the edit to fit a picture; re-record the picture instead.
- Keep the total under the account's monthly character budget; the manifest reports
  `generatedChars` for each run.

## Gate

Every segment in `narration.json` has a measured file in `audio/manifest.json`, you have listened
to it, and `fit-scenes.mjs` has sized every scene. Continue with `record-scenes`.
