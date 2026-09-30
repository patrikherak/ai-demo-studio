#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fail, flagValue, hasFlag } from "./lib/env.mjs";

const HELP = `Size every scene to its measured narration (audio-first workflow).

  node scripts/fit-scenes.mjs <audio/manifest.json> <scene.json>... [--reserve-ms 1200] [--lead-in-ms 400] [--gap-ms 350]

Each scene lists its narration segment ids in "narration": ["s01", "s02"].
Writes back into every scene:
  minDurationMs = leadIn + sum(segment durations) + gaps + reserve
  audio         = [{ "file": "...mp3", "atMs": offset from the scene start }]
Scene-level "leadInMs", "narrationGapMs" and "reserveMs" override the flags.`;

const args = process.argv.slice(2);
if (args.length < 2 || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}

const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const manifestPath = resolve(positional[0]);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const byId = new Map(manifest.segments.map((s) => [s.id, s]));
const defaults = {
  reserveMs: Number(flagValue(args, "--reserve-ms") ?? 1200),
  leadInMs: Number(flagValue(args, "--lead-in-ms") ?? 400),
  gapMs: Number(flagValue(args, "--gap-ms") ?? 350),
};

const used = new Set();
let totalMs = 0;
for (const scenePath of positional.slice(1).map((p) => resolve(p))) {
  const scene = JSON.parse(readFileSync(scenePath, "utf8"));
  const narration = scene.narration ?? [];
  const leadInMs = scene.leadInMs ?? defaults.leadInMs;
  const gapMs = scene.narrationGapMs ?? defaults.gapMs;
  const reserveMs = scene.reserveMs ?? defaults.reserveMs;
  let cursor = leadInMs;
  const audio = [];
  for (const id of narration) {
    const segment = byId.get(id);
    if (!segment) fail(`${scenePath}: narration segment "${id}" is not in ${manifestPath}`);
    if (used.has(id)) fail(`segment "${id}" is used by more than one scene`);
    used.add(id);
    const file = resolve(dirname(manifestPath), segment.file);
    audio.push({ id, file: relative(dirname(scenePath), file), atMs: Math.round(cursor), durationMs: Math.round(segment.durationSec * 1000) });
    cursor += segment.durationSec * 1000 + gapMs;
  }
  const spoken = audio.length ? cursor - gapMs : leadInMs;
  scene.audio = audio;
  scene.minDurationMs = Math.max(scene.minDurationMs && !audio.length ? scene.minDurationMs : 0, Math.round(spoken + reserveMs));
  totalMs += scene.minDurationMs;
  writeFileSync(scenePath, JSON.stringify(scene, null, 2) + "\n");
  console.log(`${scene.id ?? scenePath}: ${audio.length} segment(s), minDurationMs=${scene.minDurationMs}`);
}
const unused = manifest.segments.map((s) => s.id).filter((id) => !used.has(id));
if (unused.length) console.log(`WARN segments not assigned to any scene: ${unused.join(", ")}`);
console.log(`planned runtime ≈ ${(totalMs / 1000).toFixed(1)}s`);
