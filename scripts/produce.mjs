#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { REPO_ROOT, fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import { mediaDuration } from "./lib/media.mjs";
import { loadScene, sceneHash } from "./lib/scene.mjs";

const HELP = `Produce the finished video of a job folder in one run.

  node scripts/produce.mjs work/<slug> [--only 03,05] [--record changed|all|none]
                           [--no-narrate] [--no-music] [--open] [--reveal] [--allow-misses]

Runs, in order: narrate.mjs (when narration.json exists), fit-scenes.mjs, record.mjs for
every scene whose content changed since its last take (sceneHash), build-clip.mjs, a music
bed of the exact total length (music.py, cached), concat.mjs with ducking and loudness
mastering, av_check.py and a final contact sheet. Scenes are scenes/*.json in name order;
files starting with "_" are shared bases for "extends" and are skipped.

Optional work/<slug>/job.json:
  { "bpm": 100, "loudness": -16, "sfx": true, "output": "final/<slug>-demo.mp4",
    "music": { "mood": "bright", "gain": -13, "duck": 10, "file": null, "seed": 7 },
    "maxSilence": 3 }
A take with a selector miss stops the run (exit 2) unless --allow-misses.`;

const args = process.argv.slice(2);
if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
loadEnv();

const job = resolve(args.find((a) => !a.startsWith("--")) ?? fail("job folder is required"));
const slug = basename(job);
const config = existsSync(join(job, "job.json")) ? JSON.parse(readFileSync(join(job, "job.json"), "utf8")) : {};
const bpm = Number(config.bpm ?? 100);
const recordMode = flagValue(args, "--record") ?? "changed";
const only = (flagValue(args, "--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const sceneDir = join(job, "scenes");
if (!existsSync(sceneDir)) fail(`${sceneDir} does not exist`);
const scenes = readdirSync(sceneDir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort().map((f) => join(sceneDir, f));
if (!scenes.length) fail(`no scenes in ${sceneDir}`);
const selected = only.length ? scenes.filter((s) => only.some((o) => basename(s).startsWith(o))) : scenes;
const started = Date.now();

function step(title, script, scriptArgs, { allowExit = [] } = {}) {
  console.log(`\n== ${title}`);
  const command = script.endsWith(".py") ? "python3" : script.endsWith(".sh") ? "bash" : process.execPath;
  const result = spawnSync(command, [join(REPO_ROOT, "scripts", script), ...scriptArgs], { stdio: "inherit", env: process.env });
  if (result.status !== 0 && !allowExit.includes(result.status)) fail(`${title} failed (exit ${result.status})`, result.status || 1);
  return result.status;
}

const narration = join(job, "narration.json");
const manifest = join(job, "audio", "manifest.json");
if (existsSync(narration) && !hasFlag(args, "--no-narrate")) step("narration", "narrate.mjs", [narration, "--timestamps"]);
if (existsSync(manifest)) step("fit scenes", "fit-scenes.mjs", [manifest, ...scenes, "--bpm", String(bpm)]);

const sfxDir = join(job, "audio", "sfx");
if (config.sfx !== false && !existsSync(join(sfxDir, "click.wav"))) step("sound effects", "music.py", ["--sfx-dir", sfxDir]);

for (const scenePath of selected) {
  const scene = loadScene(scenePath);
  const raw = resolve(sceneDir, scene.output);
  const sidecar = existsSync(`${raw}.json`) ? JSON.parse(readFileSync(`${raw}.json`, "utf8")) : null;
  const stale = !existsSync(raw) || !sidecar || sidecar.sceneHash !== sceneHash(scene) || (sidecar.misses?.length ?? 0) > 0;
  if (recordMode === "all" || (recordMode === "changed" && stale)) {
    const status = step(`record ${basename(scenePath)}`, "record.mjs", [scenePath], { allowExit: [2] });
    if (status === 2 && !hasFlag(args, "--allow-misses")) fail(`${basename(scenePath)} has selector misses; fix the scene and run again`, 2);
  } else {
    console.log(`\n== record ${basename(scenePath)}: unchanged, reusing ${basename(raw)}`);
  }
  step(`clip ${basename(scenePath)}`, "build-clip.mjs", [scenePath, ...(hasFlag(args, "--allow-misses") ? ["--allow-misses"] : [])]);
}

const clips = scenes.map((scenePath) => {
  const scene = loadScene(scenePath);
  const raw = resolve(sceneDir, scene.output);
  return resolve(sceneDir, scene.clip ?? join(resolve(raw, "..").replace(/raw$/, "clips"), basename(raw).replace(/\.(webm|mp4|mkv|mov)$/i, ".mp4")));
});
for (const clip of clips) if (!existsSync(clip)) fail(`clip ${clip} is missing; run without --only once`);
const totalSec = clips.reduce((sum, clip) => sum + (mediaDuration(clip) ?? 0), 0);

const concatArgs = [];
if (!hasFlag(args, "--no-music")) {
  const music = config.music ?? {};
  let bed = music.file ? resolve(job, music.file) : join(job, "audio", "music.wav");
  if (!music.file) {
    const stamp = join(job, "audio", "music.json");
    const wanted = { duration: Number(totalSec.toFixed(3)), bpm, mood: music.mood ?? "bright", seed: music.seed ?? 7 };
    const previous = existsSync(stamp) ? readFileSync(stamp, "utf8") : "";
    if (previous !== JSON.stringify(wanted) || !existsSync(bed)) {
      step("music", "music.py", ["--duration", String(wanted.duration), "--bpm", String(bpm), "--mood", wanted.mood, "--seed", String(wanted.seed), "--out", bed]);
      writeFileSync(stamp, JSON.stringify(wanted));
    } else console.log("\n== music: unchanged, reusing music.wav");
  }
  if (!existsSync(bed)) fail(`music file ${bed} does not exist`);
  concatArgs.push("--music", bed, "--music-gain", String(music.gain ?? -13), "--duck-db", String(music.duck ?? 10));
}
const output = resolve(job, config.output ?? join("final", `${slug}-demo.mp4`));
mkdirSync(resolve(output, ".."), { recursive: true });
step("join and master", "concat.mjs", [output, ...clips, ...concatArgs, "--loudness", String(config.loudness ?? -16)]);
step("checks", "av_check.py", [output, "--expect-audio", "--max-silence", String(config.maxSilence ?? 3)]);
step("contact sheet", "qa-frames.sh", [output, join(job, "qa", "final"), "24"]);

const opener = [];
if (hasFlag(args, "--open")) opener.push(process.platform === "darwin" ? ["open", [output]] : process.platform === "win32" ? ["explorer", [output]] : ["xdg-open", [output]]);
if (hasFlag(args, "--reveal")) opener.push(process.platform === "darwin" ? ["open", ["-R", output]] : process.platform === "win32" ? ["explorer", [`/select,${output}`]] : ["xdg-open", [resolve(output, "..")]]);
for (const [command, commandArgs] of opener) spawnSync(command, commandArgs, { stdio: "ignore" });

console.log(`\nPRODUCED ${output} ${totalSec.toFixed(1)}s from ${scenes.length} scenes in ${((Date.now() - started) / 1000).toFixed(0)}s (contact sheet: ${join(job, "qa", "final", "sheet.jpg")})`);
