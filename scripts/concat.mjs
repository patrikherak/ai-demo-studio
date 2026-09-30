#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import { ffmpegBin, run, streamDurations } from "./lib/media.mjs";

const HELP = `Join finished clips (from build-clip.mjs) into one video and keep audio and video in sync.

  node scripts/concat.mjs <final.mp4> <clip1.mp4> <clip2.mp4>... [--max-drift 0.05]

Clips must share encoding settings (build-clip.mjs guarantees that). The result is
trimmed to the video stream length when the audio drifts more than --max-drift seconds.`;

const args = process.argv.slice(2);
if (args.length < 2 || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
loadEnv();

const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [outArg, ...clipArgs] = positional;
if (!clipArgs.length) fail("at least one clip is required");
const out = resolve(outArg);
const clips = clipArgs.map((c) => resolve(c));
const maxDrift = Number(flagValue(args, "--max-drift") ?? 0.05);
mkdirSync(dirname(out), { recursive: true });

const list = resolve(tmpdir(), `concat-${process.pid}.txt`);
writeFileSync(list, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
const joined = `${out}.joined.mp4`;
try {
  run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", joined]);
  const measured = streamDurations(joined);
  const drift = measured?.video && measured?.audio ? Math.abs(measured.video - measured.audio) : 0;
  if (drift > maxDrift && measured?.video) {
    run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", joined, "-t", measured.video.toFixed(3), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out]);
  } else {
    run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", joined, "-c", "copy", "-movflags", "+faststart", out]);
  }
} finally {
  rmSync(list, { force: true });
  rmSync(joined, { force: true });
}
const final = streamDurations(out);
const finalDrift = final?.video && final?.audio ? Math.abs(final.video - final.audio) : null;
console.log(`FINAL ${out} clips=${clips.length} video=${final?.video?.toFixed(2) ?? "?"}s audio=${final?.audio?.toFixed(2) ?? "?"}s drift=${finalDrift === null ? "n/a" : `${finalDrift.toFixed(3)}s`}`);
if (finalDrift !== null && finalDrift > maxDrift) process.exit(2);
