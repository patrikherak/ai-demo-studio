#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { envNumber, fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import { mediaDuration } from "./lib/media.mjs";

const HELP = `Generate narration with ElevenLabs, one audio file per segment, and measure it.

  node scripts/narrate.mjs <narration.json> [--out-dir DIR] [--dry-run] [--force] [--timestamps]

narration.json:
  { "voiceId": "…", "modelId": "…", "languageCode": "en",
    "voiceSettings": { "stability": 0.5, "similarity_boost": 0.75, "speed": 1.0 },
    "segments": [ { "id": "s01-hook", "text": "…" }, … ] }

voiceId/modelId default to ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL_ID from .env.
Writes <out-dir>/<id>.mp3 and <out-dir>/manifest.json (durations, text hashes).
Unchanged segments are reused, so re-running costs nothing. --dry-run only counts
characters. --timestamps also saves character alignment and an .srt per segment.`;

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

const voiceId = spec.voiceId || process.env.ELEVENLABS_VOICE_ID;
const modelId = spec.modelId || process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const outputFormat = spec.outputFormat || process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";
const languageCode = spec.languageCode || process.env.ELEVENLABS_LANGUAGE_CODE || undefined;
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
  console.log(JSON.stringify({ segments: segments.length, characters: totalChars, voiceId: voiceId ?? null, modelId, outputFormat }, null, 2));
  process.exit(0);
}
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) fail("ELEVENLABS_API_KEY is not set (see .env.example)");
if (!voiceId) fail("no voice: set voiceId in narration.json or ELEVENLABS_VOICE_ID (list voices: node scripts/voices.mjs)");

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

async function synthesize(segment, index) {
  const body = {
    text: segment.text,
    model_id: modelId,
    voice_settings: voiceSettings,
    previous_text: segments[index - 1]?.text,
    next_text: segments[index + 1]?.text,
    ...(languageCode ? { language_code: languageCode } : {}),
  };
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}${timestamps ? "/with-timestamps" : ""}?output_format=${encodeURIComponent(outputFormat)}`;
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

const results = [];
let generatedChars = 0;
for (const [index, segment] of segments.entries()) {
  const file = join(outDir, `${segment.id}.mp3`);
  const textHash = hash(`${voiceId}|${modelId}|${outputFormat}|${JSON.stringify(voiceSettings)}|${segment.text}`);
  const cached = previousById.get(segment.id);
  const reusable = !force && cached?.textHash === textHash && existsSync(file) && (!timestamps || cached.alignmentFile);
  let alignmentFile = reusable ? cached.alignmentFile ?? null : null;
  if (!reusable) {
    const { audio, alignment } = await synthesize(segment, index);
    writeFileSync(file, audio);
    generatedChars += segment.text.length;
    if (alignment) {
      alignmentFile = relative(outDir, join(outDir, `${segment.id}.alignment.json`));
      writeFileSync(join(outDir, alignmentFile), JSON.stringify(alignment));
      writeFileSync(join(outDir, `${segment.id}.srt`), alignmentToSrt(alignment));
    }
  }
  const durationSec = mediaDuration(file);
  if (!durationSec) fail(`could not measure ${file}; is ffmpeg available? (bash scripts/setup-tools.sh)`);
  results.push({ id: segment.id, file: relative(dirname(manifestPath), file), textHash, chars: segment.text.length, durationSec: Number(durationSec.toFixed(3)), alignmentFile, reused: reusable });
  console.log(`${reusable ? "reused   " : "generated"} ${segment.id} ${durationSec.toFixed(2)}s "${segment.text.slice(0, 60)}${segment.text.length > 60 ? "…" : ""}"`);
}

const manifest = {
  voiceId,
  modelId,
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
