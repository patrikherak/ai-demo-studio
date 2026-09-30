import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { ffmpegBin, run } from "./media.mjs";

export const OPENAI_VOICES = [
  ["alloy", "neutral, balanced"],
  ["ash", "clear, confident male"],
  ["ballad", "warm, expressive male"],
  ["coral", "warm, friendly female"],
  ["echo", "calm, resonant male"],
  ["fable", "bright, storytelling"],
  ["nova", "energetic, youthful female"],
  ["onyx", "deep, authoritative male"],
  ["sage", "gentle, thoughtful female"],
  ["shimmer", "soft, optimistic female"],
  ["verse", "lively, versatile male"],
];

export const OPENAI_STYLES = {
  warm: "Warm, confident and friendly product-video narrator. Natural pace, clear articulation, a light smile in the voice. Never salesy.",
  calm: "Calm, trustworthy documentary narrator. Unhurried pace, precise articulation, gentle pauses between sentences.",
  energetic: "Upbeat, energetic launch-video narrator. Crisp pace, bright tone, confident emphasis on key words.",
};

const SAMPLES = {
  en: "This is how the narration of your demo video will sound.",
  de: "So wird die Sprecherstimme Ihres Demo-Videos klingen.",
  fr: "Voici comment sonnera la narration de votre vidéo de démonstration.",
  it: "Ecco come suonerà la voce narrante del tuo video dimostrativo.",
  es: "Así sonará la narración de tu vídeo de demostración.",
  pt: "É assim que vai soar a narração do seu vídeo de demonstração.",
  nl: "Zo klinkt de voice-over van je demovideo.",
  sk: "Takto bude znieť hovorené slovo vášho demo videa.",
  cs: "Takhle bude znít komentář vašeho demo videa.",
  pl: "Tak zabrzmi narracja Twojego filmu demonstracyjnego.",
  sv: "Så här kommer berättarrösten i din demovideo att låta.",
  da: "Sådan kommer speaken i din demovideo til at lyde.",
  no: "Slik kommer fortellerstemmen i demovideoen din til å høres ut.",
  fi: "Tältä demovideosi kertojaääni kuulostaa.",
  hu: "Így fog szólni a bemutatóvideód narrációja.",
  ro: "Așa va suna narațiunea videoclipului tău demonstrativ.",
  tr: "Demo videonuzun anlatımı böyle duyulacak.",
  ru: "Так будет звучать озвучка вашего демо-видео.",
  uk: "Так звучатиме озвучення вашого демо-відео.",
  ja: "デモ動画のナレーションはこのように聞こえます。",
  zh: "这就是您的演示视频旁白的声音。",
  ko: "데모 영상의 내레이션은 이렇게 들립니다.",
  ar: "هكذا سيبدو التعليق الصوتي لفيديو العرض التوضيحي الخاص بك.",
  hi: "आपके डेमो वीडियो का वर्णन ऐसा सुनाई देगा।",
};

export function languageCode(value) {
  return String(value || "en").toLowerCase().split(/[-_]/)[0];
}

export function languageName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function narrationLanguage(spec = {}) {
  return languageCode(spec.language || spec.languageCode || process.env.NARRATION_LANGUAGE || process.env.DEMO_LANGUAGE || "en");
}

export function sampleSentence(code) {
  return SAMPLES[languageCode(code)] ?? SAMPLES.en;
}

export function elevenBase() {
  return (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, "");
}

export function openaiBase() {
  return (process.env.OPENAI_API_BASE || "https://api.openai.com").replace(/\/$/, "");
}

export function modelEnforcesLanguage(modelId) {
  return /(turbo|flash)_v2_5/.test(modelId ?? "");
}

async function elevenJson(path, { method = "GET", body } = {}) {
  const response = await fetch(`${elevenBase()}${path}`, {
    method,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status} ${path}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

export async function elevenModels(language) {
  const models = await elevenJson("/v1/models");
  return models
    .filter((m) => m.can_do_text_to_speech !== false)
    .map((m) => ({
      id: m.model_id,
      name: m.name,
      description: m.description ?? "",
      languages: (m.languages ?? []).map((l) => languageCode(l.language_id)),
      costMultiplier: m.model_rates?.character_cost_multiplier ?? null,
      enforcesLanguage: modelEnforcesLanguage(m.model_id),
    }))
    .filter((m) => !language || !m.languages.length || m.languages.includes(language));
}

export async function elevenVoices(language) {
  const { voices = [] } = await elevenJson("/v1/voices");
  return voices.map((v) => {
    const verified = (v.verified_languages ?? []).map((l) => ({ language: languageCode(l.language), accent: l.accent, locale: l.locale, previewUrl: l.preview_url }));
    const match = verified.find((l) => l.language === language);
    return {
      id: v.voice_id,
      name: v.name,
      source: "account",
      accent: match?.accent ?? v.labels?.accent ?? "",
      locale: match?.locale ?? "",
      gender: v.labels?.gender ?? "",
      age: v.labels?.age ?? "",
      useCase: v.labels?.use_case ?? v.labels?.["use case"] ?? "",
      description: v.labels?.description ?? v.description ?? "",
      previewUrl: match?.previewUrl ?? v.preview_url ?? "",
      speaksLanguage: Boolean(match) || languageCode(v.labels?.language) === language || (!verified.length && language === "en"),
    };
  });
}

export async function elevenLibrary(language, { gender, useCase, search, pageSize = 30 } = {}) {
  const params = new URLSearchParams({ page_size: String(pageSize), language });
  if (gender) params.set("gender", gender);
  if (useCase) params.set("use_cases", useCase);
  if (search) params.set("search", search);
  const { voices = [] } = await elevenJson(`/v1/shared-voices?${params}`);
  return voices.map((v) => ({
    id: v.voice_id,
    ownerId: v.public_owner_id,
    name: v.name,
    source: "library",
    accent: v.accent ?? "",
    locale: v.locale ?? "",
    gender: v.gender ?? "",
    age: v.age ?? "",
    useCase: v.use_case ?? "",
    description: v.description ?? v.descriptive ?? "",
    previewUrl: v.preview_url ?? "",
    speaksLanguage: true,
  }));
}

export async function elevenAddLibraryVoice(voice) {
  const added = await elevenJson(`/v1/voices/add/${encodeURIComponent(voice.ownerId)}/${encodeURIComponent(voice.id)}`, { method: "POST", body: { new_name: voice.name } });
  return added.voice_id ?? voice.id;
}

export async function elevenSpeak(text, { voiceId, modelId, language }, file) {
  const body = { text, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75 } };
  if (language && modelEnforcesLanguage(modelId)) body.language_code = language;
  const response = await fetch(`${elevenBase()}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

export function openaiInstructions(instructions, language) {
  const name = languageName(language);
  return language && language !== "en" ? `${instructions} Speak ${name} natively, with a natural ${name} accent.` : instructions;
}

export async function openaiSpeak(text, { voice, model = "gpt-4o-mini-tts", instructions, language, speed = 1 }, file) {
  const response = await fetch(`${openaiBase()}/v1/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice, input: text, instructions: openaiInstructions(instructions, language), speed, response_format: "mp3" }),
  });
  if (!response.ok) throw new Error(`OpenAI TTS ${response.status}: ${(await response.text()).slice(0, 200)}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

export function sayVoices(language, locale) {
  if (process.platform !== "darwin") return [];
  const list = spawnSync("say", ["-v", "?"], { encoding: "utf8" }).stdout ?? "";
  const novelty = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Zarvox|Grandma|Grandpa|Rocko|Shelley|Eddy|Flo|Reed|Sandy)\b/;
  return list.split("\n")
    .map((line) => line.match(/^(.+?)\s{2,}([a-z]{2,3}_[A-Z0-9]{2,3})\s/))
    .filter(Boolean)
    .map((m) => ({ id: m[1].trim(), name: m[1].trim(), locale: m[2].replace("_", "-"), quality: /Premium/.test(m[1]) ? 2 : /Enhanced/.test(m[1]) ? 1 : 0 }))
    .filter((v) => languageCode(v.locale) === language && !novelty.test(v.name))
    .sort((a, b) => (locale && b.locale === locale) - (locale && a.locale === locale) || b.quality - a.quality);
}

export function saySpeak(text, { voice, rate = 180 }, file) {
  const aiff = `${file}.aiff`;
  run("say", ["-v", voice, "-r", String(rate), "-o", aiff, text]);
  run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", aiff, "-ar", "44100", "-ac", "1", "-b:a", "128k", file]);
  rmSync(aiff, { force: true });
  return file;
}

export async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

export function play(file) {
  if (process.env.DEMO_NO_PLAY) return false;
  const players = process.platform === "darwin" ? [["afplay", [file]]] : [["paplay", [file]], ["aplay", [file]], ["mpg123", ["-q", file]], ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file]]];
  for (const [command, args] of players) {
    const result = spawnSync(command, args, { stdio: "ignore" });
    if (result.status === 0) return true;
  }
  return false;
}

export function updateEnvFile(file, values) {
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { text = ""; }
  const lines = text ? text.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value ?? ""}`;
    const index = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(l));
    if (index >= 0) lines[index] = line;
    else lines.push(line);
  }
  writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
}
