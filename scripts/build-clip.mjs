#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import { outputSize } from "./lib/frames.mjs";
import { ffmpegBin, mediaDuration, run, streamDurations } from "./lib/media.mjs";
import { loadScene } from "./lib/scene.mjs";
import { renderStage, validateStage } from "./lib/stage.mjs";

const HELP = `Turn one recorded scene into a finished clip: trim the loading lead-in,
encode H.264, and lay the scene's narration on an AAC track.

  node scripts/build-clip.mjs <scene.json> [--out clip.mp4] [--width 1920] [--fps 30] [--crf 20]

Reads scene.output and its sidecar (<output>.json from record.mjs) and the
scene's "audio" timeline (from fit-scenes.mjs). Narration is never cut: if it
runs past the picture, the last frame is held. Every clip gets an audio track
(silence when there is no narration) so clips concatenate cleanly.

A scene with "stage" is composited first: the recording is placed in a browser
window or phone on the brand background, with auto-zoom on clicks, click ripples,
floating callouts from legend steps and enter/exit motion (see record-scenes).
Card and stage clips default to the DEMO_OUTPUT canvas (1920x1080).

Sound effects (--sfx DIR, or scene "sfx": true with DEMO_SFX_DIR): a soft click on
every recorded click, a pop when a callout appears, a whoosh when a stage or card
scene enters, plus any scene "sfxCues": [{ "file": "chime", "atMs": 5200, "gainDb": -10 }].
Generate the files with: python3 scripts/music.py --sfx-dir <dir>.`;

const args = process.argv.slice(2);
if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
loadEnv();

const scenePath = resolve(args[0]);
const scene = loadScene(scenePath);
const base = dirname(scenePath);
const raw = resolve(base, scene.output);
if (!existsSync(raw)) fail(`raw recording ${raw} does not exist; run record.mjs first`);
const sidecarPath = `${raw}.json`;
const sidecar = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, "utf8")) : { startSec: 0 };
if (sidecar.misses?.length && !hasFlag(args, "--allow-misses")) fail(`${basename(raw)} has ${sidecar.misses.length} miss(es); re-record or pass --allow-misses`);

const defaultClip = join(dirname(raw).replace(/raw$/, "clips"), basename(raw).replace(/\.(webm|mp4|mkv|mov)$/i, ".mp4"));
const out = resolve(base, flagValue(args, "--out") ?? scene.clip ?? (resolve(defaultClip) === raw ? raw.replace(/\.[^.]+$/, ".clip.mp4") : defaultClip));
mkdirSync(dirname(out), { recursive: true });
const canvas = scene.canvas ?? outputSize();
const width = Number(flagValue(args, "--width") ?? (scene.stage || scene.card ? canvas.width : scene.viewport?.width ?? 1600));
const stageProblems = validateStage(scene.stage);
if (stageProblems.length) fail(`${scenePath}: ${stageProblems.join(", ")}`);
const fps = Number(flagValue(args, "--fps") ?? 30);
const crf = Number(flagValue(args, "--crf") ?? 20);
const reserveSec = (scene.reserveMs ?? 1200) / 1000;

const rawDuration = mediaDuration(raw);
if (!rawDuration) fail(`cannot measure ${raw}`);
const start = Math.max(0, sidecar.startSec ?? 0);
const pictureSec = Math.max(0.5, rawDuration - start);
const audio = (scene.audio ?? []).map((a) => ({ ...a, path: resolve(base, a.file) }));
for (const a of audio) if (!existsSync(a.path)) fail(`narration file ${a.path} is missing`);
const sfxDir = flagValue(args, "--sfx") ?? (scene.sfx ? (typeof scene.sfx === "string" ? resolve(base, scene.sfx) : process.env.DEMO_SFX_DIR) : null);
const cues = [];
if (sfxDir && scene.sfx !== false) {
  const file = (name) => resolve(sfxDir, name.endsWith(".wav") ? name : `${name}.wav`);
  const events = sidecar.events ?? [];
  if (scene.stage || scene.card) cues.push({ path: file("whoosh"), atMs: 0, gainDb: -20 });
  for (const e of events) {
    if (e.atMs < 0) continue;
    if (e.kind === "click") cues.push({ path: file("click"), atMs: e.atMs, gainDb: -17 });
    if (e.kind === "legend" && scene.stage) cues.push({ path: file("pop"), atMs: e.atMs, gainDb: -19 });
  }
  for (const cue of scene.sfxCues ?? []) cues.push({ path: file(cue.file), atMs: cue.atMs ?? 0, gainDb: cue.gainDb ?? -12 });
  for (const cue of cues) if (!existsSync(cue.path)) fail(`sound effect ${cue.path} is missing (python3 scripts/music.py --sfx-dir ${sfxDir})`);
}
const audioEndSec = audio.reduce((end, a) => Math.max(end, a.atMs / 1000 + (a.durationMs ?? (mediaDuration(a.path) ?? 0) * 1000) / 1000), 0);
const plannedSec = Math.max(pictureSec, audio.length ? audioEndSec + reserveSec : 0);
const totalSec = scene.beatMs ? Math.ceil((plannedSec * 1000 - 1) / scene.beatMs) * scene.beatMs / 1000 : plannedSec;
const holdSec = Math.max(0, totalSec - pictureSec);

let picture = { file: raw, start, hold: holdSec };
if (scene.stage) {
  const staged = `${out}.stage.mp4`;
  const result = await renderStage({ scene, scenePath, raw, sidecar, startSec: start, totalSec, fps, out: staged });
  console.log(`STAGE ${scene.stage.layout ?? "browser"} ${result.frames} frames ${result.msPerFrame.toFixed(0)} ms/frame${result.errors.length ? ` page errors: ${result.errors.slice(0, 3).join(" | ")}` : ""}`);
  picture = { file: staged, start: 0, hold: 0 };
}

const inputs = ["-i", picture.file];
for (const a of audio) inputs.push("-i", a.path);
for (const c of cues) inputs.push("-i", c.path);
const videoChain = `[0:v]trim=start=${picture.start.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},scale=${width}:-2:flags=lanczos:out_range=tv:out_color_matrix=bt709,format=yuv420p${picture.hold > 0.01 ? `,tpad=stop_mode=clone:stop_duration=${picture.hold.toFixed(3)}` : ""}[v]`;
let audioChain;
const layers = [...audio.map((a) => ({ atMs: a.atMs, gainDb: 0 })), ...cues];
if (layers.length) {
  const delayed = layers.map((a, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${a.gainDb}dB,adelay=${Math.round(a.atMs)}|${Math.round(a.atMs)}[a${i}]`);
  audioChain = `${delayed.join(";")};${layers.map((_, i) => `[a${i}]`).join("")}amix=inputs=${layers.length}:normalize=0:dropout_transition=0,apad,atrim=0:${totalSec.toFixed(3)}[a]`;
} else {
  inputs.push("-f", "lavfi", "-t", totalSec.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
  audioChain = `[1:a]atrim=0:${totalSec.toFixed(3)}[a]`;
}

run(ffmpegBin(), [
  "-y", "-hide_banner", "-loglevel", "error", ...inputs,
  "-filter_complex", `${videoChain};${audioChain}`,
  "-map", "[v]", "-map", "[a]", "-t", totalSec.toFixed(3),
  "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(fps),
  "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out,
]);

if (picture.file !== raw) rmSync(picture.file, { force: true });
const measured = streamDurations(out);
const drift = measured?.video && measured?.audio ? Math.abs(measured.video - measured.audio) : null;
console.log(`CLIP ${out} duration=${totalSec.toFixed(2)}s picture=${pictureSec.toFixed(2)}s hold=${holdSec.toFixed(2)}s narration=${audio.length} sfx=${cues.length} drift=${drift === null ? "n/a" : `${drift.toFixed(3)}s`}`);
if (holdSec > 2) console.log(`WARN narration outlasts the picture by ${holdSec.toFixed(1)}s; re-run fit-scenes.mjs and re-record for a live picture instead of a frozen frame`);
