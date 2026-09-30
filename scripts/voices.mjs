#!/usr/bin/env node
import { fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import { elevenBase } from "./lib/voice.mjs";

const HELP = `List ElevenLabs voices available to your account, with their labels.

  node scripts/voices.mjs [--accent american] [--gender female] [--use-case narration] [--search warm] [--json]

Pick a voice whose labels match the brief (accent and use case matter more than
language), then set ELEVENLABS_VOICE_ID or "voiceId" in narration.json. For a guided
choice by language, with models, the public library and samples, use
node scripts/configure-voice.mjs.`;

const args = process.argv.slice(2);
if (hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(0);
}
loadEnv();
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) fail("ELEVENLABS_API_KEY is not set (see .env.example)");

const response = await fetch(`${elevenBase()}/v1/voices`, { headers: { "xi-api-key": apiKey } });
if (!response.ok) fail(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
const { voices = [] } = await response.json();

const filters = {
  accent: flagValue(args, "--accent")?.toLowerCase(),
  gender: flagValue(args, "--gender")?.toLowerCase(),
  use_case: flagValue(args, "--use-case")?.toLowerCase(),
};
const search = flagValue(args, "--search")?.toLowerCase();

const rows = voices
  .map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category,
    accent: v.labels?.accent ?? "",
    gender: v.labels?.gender ?? "",
    age: v.labels?.age ?? "",
    useCase: v.labels?.use_case ?? v.labels?.["use case"] ?? "",
    description: v.labels?.description ?? v.description ?? "",
    previewUrl: v.preview_url ?? "",
  }))
  .filter((v) => !filters.accent || v.accent.toLowerCase().includes(filters.accent))
  .filter((v) => !filters.gender || v.gender.toLowerCase() === filters.gender)
  .filter((v) => !filters.use_case || v.useCase.toLowerCase().includes(filters.use_case))
  .filter((v) => !search || JSON.stringify(v).toLowerCase().includes(search));

if (hasFlag(args, "--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  for (const v of rows) {
    console.log(`${v.voiceId}  ${v.name.padEnd(18)} ${v.accent.padEnd(14)} ${v.gender.padEnd(8)} ${v.age.padEnd(12)} ${v.useCase.padEnd(18)} ${v.description}`);
  }
  console.log(`${rows.length} of ${voices.length} voices`);
}
