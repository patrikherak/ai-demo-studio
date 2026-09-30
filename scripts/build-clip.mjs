#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import { ffmpegBin, mediaDuration, run, streamDurations } from "./lib/media.mjs";

const HELP = `Turn one recorded scene into a finished clip: trim the loading lead-in,
encode H.264, and lay the scene's narration on an AAC track.

  node scripts/build-clip.mjs <scene.json> [--out clip.mp4] [--width 1600] [--fps 30] [--crf 20]

Reads scene.output (.webm) and its sidecar (.webm.json from record.mjs) and the
scene's "audio" timeline (from fit-scenes.mjs). Narration is never cut: if it
runs past the picture, the last frame is held. Every clip gets an audio track
(silence when there is no narration) so clips concatenate cleanly.`;

const args = process.argv.slice(2);
if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
loadEnv();

const scenePath = resolve(args[0]);
const scene = JSON.parse(readFileSync(scenePath, "utf8"));
const base = dirname(scenePath);
const raw = resolve(base, scene.output);
if (!existsSync(raw)) fail(`raw recording ${raw} does not exist; run record.mjs first`);
const sidecarPath = `${raw}.json`;
const sidecar = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, "utf8")) : { startSec: 0 };
if (sidecar.misses?.length && !hasFlag(args, "--allow-misses")) fail(`${basename(raw)} has ${sidecar.misses.length} miss(es); re-record or pass --allow-misses`);

const out = resolve(base, flagValue(args, "--out") ?? scene.clip ?? join(dirname(raw).replace(/raw$/, "clips"), basename(raw).replace(/\.webm$/, ".mp4")));
mkdirSync(dirname(out), { recursive: true });
const width = Number(flagValue(args, "--width") ?? scene.viewport?.width ?? 1600);
const fps = Number(flagValue(args, "--fps") ?? 30);
const crf = Number(flagValue(args, "--crf") ?? 20);
const reserveSec = (scene.reserveMs ?? 1200) / 1000;

const rawDuration = mediaDuration(raw);
if (!rawDuration) fail(`cannot measure ${raw}`);
const start = Math.max(0, sidecar.startSec ?? 0);
const pictureSec = Math.max(0.5, rawDuration - start);
const audio = (scene.audio ?? []).map((a) => ({ ...a, path: resolve(base, a.file) }));
for (const a of audio) if (!existsSync(a.path)) fail(`narration file ${a.path} is missing`);
const audioEndSec = audio.reduce((end, a) => Math.max(end, a.atMs / 1000 + (a.durationMs ?? (mediaDuration(a.path) ?? 0) * 1000) / 1000), 0);
const totalSec = Math.max(pictureSec, audio.length ? audioEndSec + reserveSec : 0);
const holdSec = Math.max(0, totalSec - pictureSec);

const inputs = ["-i", raw];
for (const a of audio) inputs.push("-i", a.path);
const videoChain = `[0:v]trim=start=${start.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},scale=${width}:-2:flags=lanczos,format=yuv420p${holdSec > 0.01 ? `,tpad=stop_mode=clone:stop_duration=${holdSec.toFixed(3)}` : ""}[v]`;
let audioChain;
if (audio.length) {
  const delayed = audio.map((a, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(a.atMs)}|${Math.round(a.atMs)}[a${i}]`);
  audioChain = `${delayed.join(";")};${audio.map((_, i) => `[a${i}]`).join("")}amix=inputs=${audio.length}:normalize=0:dropout_transition=0,apad,atrim=0:${totalSec.toFixed(3)}[a]`;
} else {
  inputs.push("-f", "lavfi", "-t", totalSec.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
  audioChain = `[1:a]atrim=0:${totalSec.toFixed(3)}[a]`;
}

run(ffmpegBin(), [
  "-y", "-hide_banner", "-loglevel", "error", ...inputs,
  "-filter_complex", `${videoChain};${audioChain}`,
  "-map", "[v]", "-map", "[a]", "-t", totalSec.toFixed(3),
  "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(fps),
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out,
]);

const measured = streamDurations(out);
const drift = measured?.video && measured?.audio ? Math.abs(measured.video - measured.audio) : null;
console.log(`CLIP ${out} duration=${totalSec.toFixed(2)}s picture=${pictureSec.toFixed(2)}s hold=${holdSec.toFixed(2)}s narration=${audio.length} drift=${drift === null ? "n/a" : `${drift.toFixed(3)}s`}`);
if (holdSec > 2) console.log(`WARN narration outlasts the picture by ${holdSec.toFixed(1)}s; re-run fit-scenes.mjs and re-record for a live picture instead of a frozen frame`);
