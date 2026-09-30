#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import { ffmpegBin, run, streamDurations } from "./lib/media.mjs";

const HELP = `Join finished clips (from build-clip.mjs) into one video and keep audio and video in sync.

  node scripts/concat.mjs <final.mp4> <clip1.mp4> <clip2.mp4>... [--max-drift 0.05]
      [--music bed.wav] [--music-gain -14] [--duck-db 9] [--loudness -16] [--open] [--reveal]

Clips must share encoding settings (build-clip.mjs guarantees that). The result is
trimmed to the video stream length when the audio drifts more than --max-drift seconds.

--music lays a background bed (scripts/music.py or any licensed track) under the
whole video: it is trimmed to the video, faded in and out, and ducked under the
narration with a sidechain compressor, so the voice always stays on top.
--loudness masters the final mix to that integrated loudness (LUFS, true peak
-1.5 dBTP); -16 suits web and social players. --open opens the finished video,
--reveal shows it in Finder / Explorer / the file manager.`;

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
  const musicFile = flagValue(args, "--music");
  const loudness = flagValue(args, "--loudness");
  if (musicFile || loudness) {
    if (musicFile && !existsSync(resolve(musicFile))) fail(`music file ${musicFile} does not exist`);
    const length = measured?.video ?? measured?.format;
    const musicGain = Number(flagValue(args, "--music-gain") ?? -14);
    const duckDb = Number(flagValue(args, "--duck-db") ?? 9);
    const target = Number(loudness ?? -16);
    const mixed = `${out}.mixed.mp4`;
    const graph = musicFile
      ? `[0:a]aresample=48000,asplit=2[voice][key];[1:a]aresample=48000,volume=${musicGain}dB,atrim=0:${length.toFixed(3)},afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, length - 2.5).toFixed(3)}:d=2.5[bed];[bed][key]sidechaincompress=threshold=0.03:ratio=${Math.max(2, duckDb / 1.5).toFixed(1)}:attack=15:release=450:makeup=1[ducked];[voice][ducked]amix=inputs=2:normalize=0:duration=first,loudnorm=I=${target}:TP=-1.5:LRA=11[a]`
      : `[0:a]loudnorm=I=${target}:TP=-1.5:LRA=11[a]`;
    run(ffmpegBin(), [
      "-y", "-hide_banner", "-loglevel", "error", "-i", joined, ...(musicFile ? ["-stream_loop", "-1", "-i", resolve(musicFile)] : []),
      "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-t", length.toFixed(3),
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", mixed,
    ]);
    renameSync(mixed, joined);
  }
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
if (hasFlag(args, "--open")) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const opened = spawnSync(opener, [out], { stdio: "ignore" });
  console.log(opened.status === 0 ? `OPENED ${out}` : `WARN could not open ${out} with ${opener}`);
}
if (hasFlag(args, "--reveal")) {
  const [command, commandArgs] = process.platform === "darwin" ? ["open", ["-R", out]] : process.platform === "win32" ? ["explorer", [`/select,${out}`]] : ["xdg-open", [dirname(out)]];
  const revealed = spawnSync(command, commandArgs, { stdio: "ignore" });
  console.log(revealed.status === 0 ? `REVEALED ${out}` : `WARN could not reveal ${out}`);
}
