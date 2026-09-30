#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fail, hasFlag } from "./lib/env.mjs";
import { loadScene } from "./lib/scene.mjs";

const HELP = `Show a recorded scene's voice and actions on one timeline.

  node scripts/sync-report.mjs <scene.json> [--words]

Reads the scene's narration timing (cues/words from fit-scenes.mjs) and the take's
sidecar (events from record.mjs) and prints, in seconds from the scene start, every
spoken sentence (or word with --words) next to every click, typed field, callout and
navigation. Ends with where the voice ends, where the actions end and the overrun, so
you can move waits or rewrite a sentence until each claim is spoken while it is shown.`;

const args = process.argv.slice(2);
if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
const scenePath = resolve(args.find((a) => !a.startsWith("--")));
const scene = loadScene(scenePath);
const raw = resolve(dirname(scenePath), scene.output);
if (!existsSync(`${raw}.json`)) fail(`no sidecar ${raw}.json; record the scene first`);
const sidecar = JSON.parse(readFileSync(`${raw}.json`, "utf8"));
const manifestPath = scene.audio?.[0] ? resolve(dirname(scenePath), scene.audio[0].file, "..", "manifest.json") : null;
const manifest = manifestPath && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { segments: [] };
const byId = new Map(manifest.segments.map((s) => [s.id, s]));
const narrationPath = manifestPath ? resolve(dirname(manifestPath), "..", "narration.json") : null;
const texts = new Map((narrationPath && existsSync(narrationPath) ? JSON.parse(readFileSync(narrationPath, "utf8")).segments : []).map((s) => [s.id, s.text]));

const rows = [];
for (const a of scene.audio ?? []) {
  const segment = byId.get(a.id);
  const text = texts.get(a.id) ?? "";
  if (hasFlag(args, "--words") && segment?.words?.length) {
    for (const w of segment.words) rows.push({ t: a.atMs / 1000 + w.start, voice: w.word });
  } else {
    const sentences = text.match(/[^.!?…]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
    (segment?.sentenceStarts ?? [0]).forEach((start, i) => rows.push({ t: a.atMs / 1000 + start, voice: sentences[i] ?? "" }));
  }
}
const describe = (e) => {
  if (e.kind === "legend") return `callout  ${e.title ?? ""}${e.text ? ` · ${e.text}` : ""}`;
  if (e.kind === "navigate") return `goto     ${e.url}`;
  return `${e.kind.padEnd(8)} ${e.target ?? ""}`;
};
for (const e of sidecar.events ?? []) if (e.atMs >= 0 && e.kind !== "scroll") rows.push({ t: e.atMs / 1000, action: describe(e) });
rows.sort((a, b) => a.t - b.t || (a.voice ? -1 : 1));

console.log(`${scene.id ?? scenePath}`);
for (const r of rows) console.log(`${r.t.toFixed(2).padStart(6)}  ${r.voice ? `VOICE  ${r.voice}` : `       ${r.action}`}`);
const voiceEnd = (scene.audio ?? []).reduce((end, a) => Math.max(end, (a.atMs + a.durationMs) / 1000), 0);
const actionEnd = Math.max(0, ...(sidecar.events ?? []).map((e) => e.atMs / 1000));
console.log(`\nvoice ends ${voiceEnd.toFixed(2)}s · last action ${actionEnd.toFixed(2)}s · take ${sidecar.sceneSec}s · planned ${(scene.minDurationMs ?? 0) / 1000}s`);
if (sidecar.plannedOverrunSec > 0) console.log(`actions overran the plan by ${sidecar.plannedOverrunSec}s: shorten waits, split the scene or give the sentence more words`);
if (voiceEnd && actionEnd > voiceEnd + 1.5) console.log(`the last ${(actionEnd - voiceEnd).toFixed(1)}s of action happen after the voice stopped`);
