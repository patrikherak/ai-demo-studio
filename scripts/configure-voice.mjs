#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { REPO_ROOT, fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import {
  OPENAI_STYLES, OPENAI_VOICES, download, elevenAddLibraryVoice, elevenLibrary, elevenModels, elevenSpeak, elevenVoices,
  languageCode, languageName, modelEnforcesLanguage, narrationLanguage, openaiSpeak, play, sampleSentence, sayVoices,
  saySpeak, updateEnvFile,
} from "./lib/voice.mjs";

const HELP = `Choose the narration language, provider, model and voice, and save them to .env.

Interactive (a person at the terminal):
  node scripts/configure-voice.mjs
    asks for the language, the provider (and its API key if missing, hidden), then
    ElevenLabs model and voice (your voices or the public library for that language),
    OpenAI voice and style, or a macOS voice; plays samples in that language and
    writes NARRATION_* / ELEVENLABS_* / OPENAI_TTS_* to .env.

Non-interactive (an agent):
  node scripts/configure-voice.mjs --list models --language de [--json]
  node scripts/configure-voice.mjs --list voices --language de [--provider elevenlabs|openai|say]
                                   [--library] [--gender female] [--search calm] [--json]
  node scripts/configure-voice.mjs --set --language de [--locale de-CH] --provider elevenlabs
                                   --model eleven_multilingual_v2 --voice <id or name> [--add-library]
  node scripts/configure-voice.mjs --set --language fr --provider openai --voice coral --style warm
  node scripts/configure-voice.mjs --sample [--out sample.mp3]    speak a test sentence with .env

--env-path PATH writes somewhere else than the repository's .env. Keys are never printed.`;

const args = process.argv.slice(2);
if (hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(0);
}
loadEnv();
const envFile = flagValue(args, "--env-path") ?? join(REPO_ROOT, ".env");
const json = hasFlag(args, "--json");
const scratch = join(tmpdir(), `ai-demo-voice-${process.pid}`);
mkdirSync(scratch, { recursive: true });

const available = () => [
  ...(process.env.ELEVENLABS_API_KEY ? ["elevenlabs"] : []),
  ...(process.env.OPENAI_API_KEY ? ["openai"] : []),
  ...(process.platform === "darwin" ? ["say"] : []),
];

function voiceRow(v) {
  return [v.name, v.accent || v.locale, v.gender, v.age, v.useCase, v.description].filter(Boolean).join(" · ");
}

async function listVoices(provider, language, options) {
  if (provider === "elevenlabs") {
    if (options.library) return elevenLibrary(language, options);
    const voices = await elevenVoices(language);
    const matching = voices.filter((v) => v.speaksLanguage);
    return (matching.length ? matching : voices)
      .filter((v) => !options.gender || v.gender.toLowerCase() === options.gender)
      .filter((v) => !options.search || JSON.stringify(v).toLowerCase().includes(options.search.toLowerCase()));
  }
  if (provider === "openai") return OPENAI_VOICES.map(([id, description]) => ({ id, name: id, description }));
  return sayVoices(language, options.locale);
}

async function speakSample(settings, file) {
  const text = sampleSentence(settings.language);
  if (settings.provider === "elevenlabs") return elevenSpeak(text, { voiceId: settings.voice, modelId: settings.model, language: settings.language }, file);
  if (settings.provider === "openai") return openaiSpeak(text, { voice: settings.voice, instructions: settings.instructions ?? OPENAI_STYLES.warm, language: settings.language }, file);
  return saySpeak(text, { voice: settings.voice }, file);
}

function save(settings) {
  const values = {
    NARRATION_LANGUAGE: settings.language,
    NARRATION_LOCALE: settings.locale ?? "",
    NARRATION_PROVIDER: settings.provider,
  };
  if (settings.provider === "elevenlabs") {
    values.ELEVENLABS_MODEL_ID = settings.model;
    values.ELEVENLABS_VOICE_ID = settings.voice;
    values.ELEVENLABS_LANGUAGE_CODE = modelEnforcesLanguage(settings.model) ? settings.language : "";
  }
  if (settings.provider === "openai") {
    values.OPENAI_TTS_VOICE = settings.voice;
    values.OPENAI_TTS_INSTRUCTIONS = JSON.stringify(settings.instructions ?? OPENAI_STYLES.warm);
  }
  if (settings.provider === "say") values.SAY_VOICE = JSON.stringify(settings.voice);
  if (settings.keys) Object.assign(values, settings.keys);
  updateEnvFile(envFile, values);
  const shown = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, /KEY/.test(k) ? "<saved>" : v]));
  console.log(`SAVED ${envFile}\n${Object.entries(shown).map(([k, v]) => `  ${k}=${v}`).join("\n")}`);
}

if (hasFlag(args, "--list")) {
  const what = flagValue(args, "--list");
  const language = languageCode(flagValue(args, "--language") ?? narrationLanguage());
  const provider = flagValue(args, "--provider") ?? available()[0];
  if (what === "models") {
    if (!process.env.ELEVENLABS_API_KEY) fail("ELEVENLABS_API_KEY is not set");
    const models = await elevenModels(language);
    if (json) console.log(JSON.stringify(models, null, 2));
    else for (const m of models) console.log(`${m.id.padEnd(28)} ${m.name}${m.enforcesLanguage ? " · can force the language" : ""}${m.costMultiplier ? ` · cost x${m.costMultiplier}` : ""}`);
  } else if (what === "voices") {
    const voices = await listVoices(provider, language, { library: hasFlag(args, "--library"), gender: flagValue(args, "--gender")?.toLowerCase(), search: flagValue(args, "--search"), locale: flagValue(args, "--locale") });
    if (json) console.log(JSON.stringify(voices, null, 2));
    else for (const v of voices) console.log(`${String(v.id).padEnd(24)} ${voiceRow(v)}`);
    if (!json) console.log(`${voices.length} ${provider} voice(s) for ${languageName(language)}`);
  } else fail('--list takes "models" or "voices"');
  process.exit(0);
}

if (hasFlag(args, "--set")) {
  const language = languageCode(flagValue(args, "--language") ?? narrationLanguage());
  const provider = flagValue(args, "--provider") ?? available()[0];
  if (!provider) fail("no provider available: set ELEVENLABS_API_KEY or OPENAI_API_KEY, or use macOS");
  const settings = { language, locale: flagValue(args, "--locale") ?? "", provider };
  if (provider === "elevenlabs") {
    if (!process.env.ELEVENLABS_API_KEY) fail("ELEVENLABS_API_KEY is not set");
    const models = await elevenModels(language);
    settings.model = flagValue(args, "--model") ?? (models.find((m) => m.id === "eleven_multilingual_v2") ?? models[0])?.id;
    if (!models.some((m) => m.id === settings.model)) fail(`model ${settings.model} does not support ${languageName(language)}; options: ${models.map((m) => m.id).join(", ") || "none on this account"}`);
    const wanted = flagValue(args, "--voice") ?? fail("--voice is required");
    const pool = hasFlag(args, "--add-library") ? await elevenLibrary(language, { search: wanted }) : await elevenVoices(language);
    const voice = pool.find((v) => v.id === wanted || v.name.toLowerCase() === wanted.toLowerCase());
    if (!voice) fail(`voice "${wanted}" not found (list: --list voices --language ${language}${hasFlag(args, "--add-library") ? " --library" : ""})`);
    settings.voice = voice.source === "library" ? await elevenAddLibraryVoice(voice) : voice.id;
  } else if (provider === "openai") {
    settings.voice = flagValue(args, "--voice") ?? "coral";
    if (!OPENAI_VOICES.some(([id]) => id === settings.voice)) fail(`unknown OpenAI voice ${settings.voice}`);
    settings.instructions = OPENAI_STYLES[flagValue(args, "--style") ?? "warm"] ?? flagValue(args, "--style");
  } else {
    const voices = sayVoices(language, settings.locale);
    settings.voice = flagValue(args, "--voice") ?? voices[0]?.id;
    if (!settings.voice) fail(`no macOS voice for ${languageName(language)}; install one in System Settings › Accessibility › Spoken Content`);
  }
  save(settings);
  process.exit(0);
}

if (hasFlag(args, "--sample")) {
  const provider = process.env.NARRATION_PROVIDER || available()[0];
  const settings = {
    language: narrationLanguage(), provider,
    voice: provider === "elevenlabs" ? process.env.ELEVENLABS_VOICE_ID : provider === "openai" ? process.env.OPENAI_TTS_VOICE || "coral" : process.env.SAY_VOICE || sayVoices(narrationLanguage())[0]?.id,
    model: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
    instructions: process.env.OPENAI_TTS_INSTRUCTIONS || OPENAI_STYLES.warm,
  };
  const out = flagValue(args, "--out") ?? join(scratch, "sample.mp3");
  await speakSample(settings, out);
  console.log(`SAMPLE ${out} (${settings.provider}, ${languageName(settings.language)}, ${settings.voice})`);
  if (!flagValue(args, "--out")) play(out);
  process.exit(0);
}

if (!process.stdin.isTTY) fail("no terminal: use --list and --set (see --help)");
const rl = createInterface({ input: process.stdin, output: process.stdout });
process.on("unhandledRejection", (error) => {
  if (error?.code === "ABORT_ERR") {
    console.log("\ncancelled, nothing saved");
    process.exit(130);
  }
  throw error;
});
rl.on("SIGINT", () => {
  console.log("\ncancelled, nothing saved");
  process.exit(130);
});

async function ask(question, fallback) {
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
  return answer || fallback || "";
}

async function askSecret(question) {
  rl.pause();
  process.stdout.write(`${question}: `);
  return new Promise((done) => {
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.resume();
          done(value.trim());
          return;
        }
        if (char === "\u0003") process.exit(130);
        value = char === "\u007f" ? value.slice(0, -1) : value + char;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function choose(title, items, render, { preview, extra = [] } = {}) {
  console.log(`\n${title}`);
  items.forEach((item, i) => console.log(`  ${String(i + 1).padStart(2)}  ${render(item)}`));
  for (const [key, label] of extra) console.log(`   ${key}  ${label}`);
  for (;;) {
    const answer = await ask(preview ? "number to choose, p<number> to listen" : "number", "1");
    const listen = answer.match(/^p\s*(\d+)$/i);
    if (listen && preview) {
      const item = items[Number(listen[1]) - 1];
      if (item) {
        try {
          const file = await preview(item);
          if (!play(file)) console.log(`  saved sample: ${file}`);
        } catch (error) {
          console.log(`  could not play: ${error.message}`);
        }
      }
      continue;
    }
    if (extra.some(([key]) => key === answer)) return answer;
    const item = items[Number(answer) - 1];
    if (item) return item;
  }
}

console.log("Narration setup: language, provider, model and voice. Nothing is spent until you listen to a sample.\n");
const language = languageCode(await ask("Narration language (ISO code: en, de, fr, it, es, pt, nl, sk, cs, pl, ja, …)", narrationLanguage()));
console.log(`  → ${languageName(language)}`);
const locale = await ask("Accent / locale, optional (en-US, en-GB, de-CH, pt-BR, …)", process.env.NARRATION_LOCALE || "");
const keys = {};

const providers = [
  ["elevenlabs", "ElevenLabs: most natural voices, many languages, word timing", "ELEVENLABS_API_KEY"],
  ["openai", "OpenAI gpt-4o-mini-tts: good voices, style instructions, cheap", "OPENAI_API_KEY"],
  ...(process.platform === "darwin" ? [["say", "macOS voices: offline, free, stand-in quality", null]] : []),
];
const picked = await choose("Provider", providers, ([id, label, key]) => `${label}${key && !process.env[key] ? "  (needs a key)" : ""}`);
const provider = picked[0];
if (picked[2] && !process.env[picked[2]]) {
  const key = await askSecret(`${picked[2]} (input hidden)`);
  if (!key) fail(`${picked[2]} is required for ${provider}`);
  process.env[picked[2]] = key;
  keys[picked[2]] = key;
}

const settings = { language, locale, provider, keys };
if (provider === "elevenlabs") {
  const models = await elevenModels(language);
  if (!models.length) fail(`no ElevenLabs model on this account speaks ${languageName(language)}`);
  models.sort((a, b) => (b.id === "eleven_multilingual_v2") - (a.id === "eleven_multilingual_v2"));
  const model = await choose(`Model for ${languageName(language)}`, models, (m) => `${m.id.padEnd(26)} ${m.name}${m.enforcesLanguage ? " · forces the language" : ""}${m.costMultiplier ? ` · cost x${m.costMultiplier}` : ""}`);
  settings.model = model.id;
  let voice = null;
  let library = false;
  while (!voice) {
    const voices = await listVoices("elevenlabs", language, { library, locale });
    if (!voices.length && !library) { library = true; continue; }
    const answer = await choose(`${library ? "Voice library" : "Your voices"} for ${languageName(language)}`, voices, voiceRow, {
      preview: async (v) => (v.previewUrl ? download(v.previewUrl, join(scratch, `${v.id}.mp3`)) : elevenSpeak(sampleSentence(language), { voiceId: v.id, modelId: settings.model, language }, join(scratch, `${v.id}.mp3`))),
      extra: [[library ? "a" : "l", library ? "back to your voices" : `browse the public library for ${languageName(language)}`]],
    });
    if (answer === "l" || answer === "a") { library = answer === "l"; continue; }
    voice = answer;
  }
  settings.voice = voice.source === "library" ? await elevenAddLibraryVoice(voice) : voice.id;
  if (voice.source === "library") console.log(`  added "${voice.name}" to your ElevenLabs voices`);
} else if (provider === "openai") {
  const style = await choose("Style", Object.entries(OPENAI_STYLES), ([name, text]) => `${name.padEnd(10)} ${text}`);
  settings.instructions = style[1];
  const voice = await choose(`Voice (all speak ${languageName(language)})`, OPENAI_VOICES, ([id, description]) => `${id.padEnd(8)} ${description}`, {
    preview: ([id]) => openaiSpeak(sampleSentence(language), { voice: id, instructions: settings.instructions, language }, join(scratch, `${id}.mp3`)),
  });
  settings.voice = voice[0];
} else {
  const voices = sayVoices(language, locale);
  if (!voices.length) fail(`no macOS voice for ${languageName(language)}; add one in System Settings › Accessibility › Spoken Content`);
  const voice = await choose(`macOS voice for ${languageName(language)}`, voices, (v) => `${v.name.padEnd(22)} ${v.locale}`, {
    preview: (v) => saySpeak(sampleSentence(language), { voice: v.id }, join(scratch, "say.mp3")),
  });
  settings.voice = voice.id;
}

console.log("\nFinal check with the chosen settings…");
try {
  const file = await speakSample(settings, join(scratch, "final.mp3"));
  if (!play(file)) console.log(`  sample: ${file}`);
} catch (error) {
  console.log(`  sample failed: ${error.message}`);
}
if ((await ask("Save to .env? (y/n)", "y")).toLowerCase().startsWith("y")) save(settings);
rl.close();
