#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { envNumber, fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import { ffmpegBin, mediaDuration, run } from "./lib/media.mjs";
import { elevenBase, languageName, modelEnforcesLanguage, narrationLanguage, openaiBase, openaiInstructions, sayVoices } from "./lib/voice.mjs";

const HELP = `Generate narration, one audio file per segment, and measure it.

  node scripts/narrate.mjs <narration.json> [--out-dir DIR] [--dry-run] [--force] [--timestamps] [--provider NAME]

narration.json:
  { "provider": "elevenlabs", "language": "de",
    "voiceId": "…", "modelId": "…",
    "voiceSettings": { "stability": 0.5, "similarity_boost": 0.75, "speed": 1.0 },
    "openai": { "voice": "coral", "model": "gpt-4o-mini-tts", "instructions": "Warm, confident narrator…" },
    "say": { "voice": "Ava (Premium)", "rate": 180 },
    "segments": [ { "id": "s01-hook", "text": "…" }, … ] }

Providers: elevenlabs (ELEVENLABS_API_KEY; best quality, word timing), openai
(OPENAI_API_KEY; gpt-4o-mini-tts with style instructions), say (macOS, offline,
stand-in quality). The provider comes from --provider, narration.json,
NARRATION_PROVIDER or the first one whose key is present, so a run never stops
for a missing key; the manifest and the report say which one was used.
The language comes from "language" in narration.json, else NARRATION_LANGUAGE,
else DEMO_LANGUAGE; every provider is told to speak it (see configure-voice.mjs
to pick a model and voice for it interactively).
voiceId/modelId default to ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL_ID from .env.
Writes <out-dir>/<id>.mp3 and <out-dir>/manifest.json (durations, text hashes).
Unchanged segments are reused, so re-running costs nothing. --dry-run only counts
characters. --timestamps also saves character alignment and an .srt per segment
(measured by ElevenLabs, estimated from the text for the other providers).
Every segment is mastered after generation: edge silence trimmed and loudness
normalised to -18 LUFS so segments match (--no-master keeps the raw file).
Word timing: ElevenLabs returns it; for the other providers the finished audio
is aligned with OpenAI's transcription API when OPENAI_API_KEY is set (fractions
of a cent), else sentence starts are estimated from pauses. The manifest lists
"words" and "sentenceStarts" per segment; fit-scenes.mjs turns them into cues.`;

const args = process.argv.slice(2);
if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
loadEnv();

const specPath = resolve(args.find((a) => !a.startsWith("--") && a.endsWith(".json")) ?? fail("narration.json is required"));
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const outDir = resolve(flagValue(args, "--out-dir") ?? join(dirname(specPath), "audio"));
const dryRun = hasFlag(args, "--dry-run");
const force = hasFlag(args, "--force");
const timestamps = hasFlag(args, "--timestamps");

const language = narrationLanguage(spec);
const sayAvailable = process.platform === "darwin" && spawnSync("say", ["-v", "?"], { encoding: "utf8" }).status === 0;
const provider = flagValue(args, "--provider") || spec.provider || process.env.NARRATION_PROVIDER
  || (process.env.ELEVENLABS_API_KEY ? "elevenlabs" : process.env.OPENAI_API_KEY ? "openai" : sayAvailable ? "say" : null);
if (!provider) fail("no narration provider: set ELEVENLABS_API_KEY or OPENAI_API_KEY (or run on macOS for say)");
if (!["elevenlabs", "openai", "say"].includes(provider)) fail(`unknown provider "${provider}"`);
const openai = {
  model: spec.openai?.model || process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
  voice: spec.openai?.voice || process.env.OPENAI_TTS_VOICE || "coral",
  instructions: openaiInstructions(spec.openai?.instructions || process.env.OPENAI_TTS_INSTRUCTIONS
    || "Warm, confident and friendly product-video narrator. Natural pace, clear articulation, light smile in the voice, no dramatic pauses.", language),
  speed: spec.openai?.speed ?? envNumber("OPENAI_TTS_SPEED", 1.0),
};
const say = { voice: spec.say?.voice || process.env.SAY_VOICE || (provider === "say" ? sayVoices(language, process.env.NARRATION_LOCALE)[0]?.id ?? "Samantha" : null), rate: spec.say?.rate ?? envNumber("SAY_RATE", 180) };
const voiceId = provider === "openai" ? openai.voice : provider === "say" ? say.voice : spec.voiceId || process.env.ELEVENLABS_VOICE_ID;
const modelId = spec.modelId || process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const outputFormat = spec.outputFormat || process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";
const languageCode = spec.languageCode || process.env.ELEVENLABS_LANGUAGE_CODE || (modelEnforcesLanguage(modelId) ? language : undefined);
const voiceSettings = {
  stability: envNumber("ELEVENLABS_STABILITY", 0.5),
  similarity_boost: envNumber("ELEVENLABS_SIMILARITY_BOOST", 0.75),
  style: envNumber("ELEVENLABS_STYLE", 0),
  use_speaker_boost: true,
  speed: envNumber("ELEVENLABS_SPEED", 1.0),
  ...(spec.voiceSettings ?? {}),
};

const segments = spec.segments ?? [];
if (!segments.length) fail("narration.json has no segments");
const ids = new Set();
for (const segment of segments) {
  if (!segment.id || !/^[A-Za-z0-9._-]+$/.test(segment.id)) fail(`segment id "${segment.id}" must match [A-Za-z0-9._-]+`);
  if (ids.has(segment.id)) fail(`duplicate segment id "${segment.id}"`);
  if (!segment.text?.trim()) fail(`segment "${segment.id}" has no text`);
  ids.add(segment.id);
}

const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);
if (dryRun) {
  console.log(JSON.stringify({ provider, segments: segments.length, characters: totalChars, voiceId: voiceId ?? null, modelId: provider === "openai" ? openai.model : modelId, outputFormat }, null, 2));
  process.exit(0);
}
const apiKey = process.env.ELEVENLABS_API_KEY;
if (provider === "elevenlabs" && !apiKey) fail("ELEVENLABS_API_KEY is not set (see .env.example)");
if (provider === "elevenlabs" && !voiceId) fail("no voice: set voiceId in narration.json or ELEVENLABS_VOICE_ID (list voices: node scripts/voices.mjs)");
if (provider === "openai" && !process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY is not set");

mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, "manifest.json");
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { segments: [] };
const previousById = new Map(previous.segments.map((s) => [s.id, s]));

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

function alignmentToSrt(alignment, maxChars = 42) {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const cues = [];
  let current = { text: "", start: null, end: null };
  const flush = () => {
    const text = current.text.trim();
    if (text) cues.push({ text, start: current.start, end: current.end });
    current = { text: "", start: null, end: null };
  };
  for (let i = 0; i < chars.length; i++) {
    if (current.start === null && chars[i].trim()) current.start = starts[i];
    current.text += chars[i];
    current.end = ends[i];
    const sentenceEnd = /[.!?…]/.test(chars[i]) && (chars[i + 1] === undefined || chars[i + 1] === " ");
    const tooLong = current.text.length >= maxChars && chars[i] === " ";
    if (sentenceEnd || tooLong) flush();
  }
  flush();
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start ?? 0)} --> ${srtTime(c.end ?? 0)}\n${c.text}\n`).join("\n");
}

function estimatedAlignment(text, durationSec) {
  const chars = [...text];
  const lead = 0.08, tail = 0.12;
  const span = Math.max(0.1, durationSec - lead - tail);
  const weights = chars.map((c) => (/[.!?]/.test(c) ? 6 : /[,;:]/.test(c) ? 3 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = lead;
  const starts = [], ends = [];
  for (const w of weights) { starts.push(cursor); cursor += (w / total) * span; ends.push(cursor); }
  return { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends, estimated: true };
}

async function synthesizeOpenAI(segment) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(`${openaiBase()}/v1/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: openai.model, voice: openai.voice, input: segment.text, instructions: openai.instructions, speed: openai.speed, response_format: "mp3" }),
    });
    if (response.ok) return { audio: Buffer.from(await response.arrayBuffer()), alignment: null };
    const detail = (await response.text()).slice(0, 300);
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    fail(`OpenAI TTS ${response.status} for segment "${segment.id}": ${detail}`);
  }
  return null;
}

function synthesizeSay(segment, file) {
  const aiff = `${file}.aiff`;
  run("say", ["-v", say.voice, "-r", String(say.rate), "-o", aiff, segment.text]);
  run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", aiff, "-ar", "44100", "-ac", "1", "-b:a", "128k", file]);
  rmSync(aiff, { force: true });
  return { audio: readFileSync(file), alignment: null };
}

async function synthesize(segment, index, file) {
  if (provider === "openai") return synthesizeOpenAI(segment);
  if (provider === "say") return synthesizeSay(segment, file);
  const body = {
    text: segment.text,
    model_id: modelId,
    voice_settings: voiceSettings,
    previous_text: segments[index - 1]?.text,
    next_text: segments[index + 1]?.text,
    ...(languageCode ? { language_code: languageCode } : {}),
  };
  const endpoint = `${elevenBase()}/v1/text-to-speech/${encodeURIComponent(voiceId)}${timestamps ? "/with-timestamps" : ""}?output_format=${encodeURIComponent(outputFormat)}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: timestamps ? "application/json" : "audio/mpeg" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      if (!timestamps) return { audio: Buffer.from(await response.arrayBuffer()), alignment: null };
      const json = await response.json();
      return { audio: Buffer.from(json.audio_base64, "base64"), alignment: json.alignment ?? json.normalized_alignment ?? null };
    }
    const detail = (await response.text()).slice(0, 300);
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    fail(`ElevenLabs ${response.status} for segment "${segment.id}": ${detail}`);
  }
  return null;
}

const master = !hasFlag(args, "--no-master");
function masterAudio(file) {
  const tmp = `${file}.master.mp3`;
  run(ffmpegBin(), [
    "-y", "-hide_banner", "-loglevel", "error", "-i", file,
    "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,loudnorm=I=-18:TP=-2:LRA=9",
    "-ar", "44100", "-ac", "1", "-b:a", "160k", tmp,
  ]);
  writeFileSync(file, readFileSync(tmp));
  rmSync(tmp, { force: true });
}

function sentenceCount(text) {
  return Math.max(1, (text.match(/[.!?…。！？؟]+(\s|$)|[。！？]/g) ?? []).length);
}

function sentenceStartsFromAlignment(alignment, text) {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const out = [starts.find((_, i) => chars[i]?.trim()) ?? 0];
  for (let i = 1; i < chars.length; i++) {
    if (/[.!?…]/.test(chars[i - 1]) && chars[i] === " ") {
      const next = chars.findIndex((c, j) => j > i && c.trim());
      if (next > 0) out.push(starts[next]);
    }
  }
  return out.slice(0, sentenceCount(text));
}

function sentenceStartsFromSilence(file, text) {
  const wanted = sentenceCount(text);
  const result = spawnSync(ffmpegBin(), ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-38dB:d=0.16", "-f", "null", "-"], { encoding: "utf8" });
  const log = result.stderr ?? "";
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => ({ end: Number(m[1]), length: Number(m[2]) }));
  const pauses = ends.filter((e, i) => starts[i] > 0.05).sort((a, b) => b.length - a.length).slice(0, wanted - 1).map((e) => e.end).sort((a, b) => a - b);
  return [0, ...pauses].map((t) => Number(t.toFixed(3)));
}

const normalizeWord = (w) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

async function transcribeWords(file) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(file)], { type: "audio/mpeg" }), "segment.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("language", language);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(`${openaiBase()}/v1/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    if (response.ok) return (await response.json()).words ?? [];
    if (attempt === 3 || (response.status !== 429 && response.status < 500)) {
      console.log(`WARN word alignment failed (${response.status}); falling back to pause detection`);
      return null;
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return null;
}

function alignWords(text, heard) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let cursor = 0;
  for (const word of words) {
    const key = normalizeWord(word);
    let found = -1;
    for (let j = cursor; j < Math.min(heard.length, cursor + 4); j++) if (normalizeWord(heard[j].word) === key) { found = j; break; }
    const match = found >= 0 ? heard[found] : heard[Math.min(cursor, heard.length - 1)];
    if (found >= 0) cursor = found + 1;
    out.push({ word, start: Number((match?.start ?? 0).toFixed(3)), end: Number((match?.end ?? 0).toFixed(3)), matched: found >= 0 });
  }
  return out;
}

function sentenceStartsFromWords(words) {
  const starts = [];
  words.forEach((w, i) => { if (i === 0 || /[.!?…。！？؟]$/.test(words[i - 1].word)) starts.push(w.start); });
  return starts;
}

function alignmentFromWords(text, words) {
  const characters = [], starts = [], ends = [];
  words.forEach((w, i) => {
    const span = Math.max(0.01, w.end - w.start);
    [...w.word].forEach((c, k) => { characters.push(c); starts.push(w.start + (span * k) / w.word.length); ends.push(w.start + (span * (k + 1)) / w.word.length); });
    if (i < words.length - 1) { characters.push(" "); starts.push(w.end); ends.push(words[i + 1].start); }
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends, source: "transcription" };
}

const align = !hasFlag(args, "--no-align");
const results = [];
let generatedChars = 0;
for (const [index, segment] of segments.entries()) {
  const file = join(outDir, `${segment.id}.mp3`);
  const providerKey = provider === "openai" ? `openai|${JSON.stringify(openai)}` : provider === "say" ? `say|${JSON.stringify(say)}` : `${voiceId}|${modelId}|${outputFormat}|${JSON.stringify(voiceSettings)}`;
  const textHash = hash(`${providerKey}|${segment.text}`);
  const cached = previousById.get(segment.id);
  const reusable = !force && cached?.textHash === textHash && existsSync(file) && (!timestamps || cached.alignmentFile);
  let alignmentFile = reusable ? cached.alignmentFile ?? null : null;
  if (!reusable) {
    const { audio, alignment: measured } = await synthesize(segment, index, file);
    writeFileSync(file, audio);
    generatedChars += segment.text.length;
    const alignment = measured ?? (timestamps ? estimatedAlignment(segment.text, mediaDuration(file) ?? segment.text.length / 15) : null);
    if (alignment) {
      alignmentFile = relative(outDir, join(outDir, `${segment.id}.alignment.json`));
      writeFileSync(join(outDir, alignmentFile), JSON.stringify(alignment));
      writeFileSync(join(outDir, `${segment.id}.srt`), alignmentToSrt(alignment));
    }
  }
  const mastered = master && (!reusable || cached?.mastered !== true) ? (masterAudio(file), true) : Boolean(reusable ? cached?.mastered : false);
  const durationSec = mediaDuration(file);
  if (!durationSec) fail(`could not measure ${file}; is ffmpeg available? (bash scripts/setup-tools.sh)`);
  const measuredAlignment = alignmentFile && provider === "elevenlabs" ? JSON.parse(readFileSync(join(outDir, alignmentFile), "utf8")) : null;
  const wordsFile = join(outDir, `${segment.id}.words.json`);
  let words = reusable && existsSync(wordsFile) ? JSON.parse(readFileSync(wordsFile, "utf8")) : null;
  if (!words && !measuredAlignment && align && process.env.OPENAI_API_KEY) {
    const heard = await transcribeWords(file);
    if (heard?.length) {
      words = alignWords(segment.text, heard);
      writeFileSync(wordsFile, JSON.stringify(words, null, 2));
      if (timestamps) {
        alignmentFile = relative(outDir, join(outDir, `${segment.id}.alignment.json`));
        const alignment = alignmentFromWords(segment.text, words);
        writeFileSync(join(outDir, alignmentFile), JSON.stringify(alignment));
        writeFileSync(join(outDir, `${segment.id}.srt`), alignmentToSrt(alignment));
      }
    }
  }
  const sentenceStarts = measuredAlignment ? sentenceStartsFromAlignment(measuredAlignment, segment.text) : words ? sentenceStartsFromWords(words) : sentenceStartsFromSilence(file, segment.text);
  results.push({ id: segment.id, file: relative(dirname(manifestPath), file), textHash, chars: segment.text.length, durationSec: Number(durationSec.toFixed(3)), sentenceStarts, words: words?.map(({ word, start }) => ({ word, start })) ?? null, alignmentFile, reused: reusable, mastered: master ? true : mastered });
  console.log(`${reusable ? "reused   " : "generated"} ${segment.id} ${durationSec.toFixed(2)}s "${segment.text.slice(0, 60)}${segment.text.length > 60 ? "…" : ""}"`);
}

const manifest = {
  provider,
  language,
  languageName: languageName(language),
  voiceId,
  modelId: provider === "openai" ? openai.model : provider === "say" ? "say" : modelId,
  instructions: provider === "openai" ? openai.instructions : undefined,
  outputFormat,
  languageCode: languageCode ?? null,
  voiceSettings,
  totalChars,
  generatedChars,
  totalSec: Number(results.reduce((sum, s) => sum + s.durationSec, 0).toFixed(3)),
  segments: results,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`manifest ${manifestPath} total=${manifest.totalSec}s generatedChars=${generatedChars}`);
