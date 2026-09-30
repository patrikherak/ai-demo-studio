import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function onPath(binary) {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [binary], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.split(/\r?\n/)[0].trim() : null;
}

const runnableCache = new Map();

function runnable(binary) {
  if (!binary) return false;
  if (!runnableCache.has(binary)) runnableCache.set(binary, spawnSync(binary, ["-hide_banner", "-version"], { encoding: "utf8" }).status === 0);
  return runnableCache.get(binary);
}

function resolveBinary(envName, name) {
  const configured = process.env[envName];
  if (configured && existsSync(configured) && runnable(configured)) return configured;
  const found = onPath(name);
  return found && runnable(found) ? found : null;
}

export function ffmpegBin() {
  return resolveBinary("FFMPEG", "ffmpeg") ?? "ffmpeg";
}

export function ffprobeBin() {
  return resolveBinary("FFPROBE", "ffprobe");
}

export function run(binary, args, { quiet = true } = {}) {
  const result = spawnSync(binary, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-6).join("\n");
    throw new Error(`${binary} ${args.slice(0, 4).join(" ")}… exited ${result.status}\n${detail}`);
  }
  if (!quiet) process.stdout.write(result.stdout);
  return result;
}

function durationFromDecode(file) {
  const result = spawnSync(ffmpegBin(), ["-hide_banner", "-nostats", "-i", file, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const times = [...(result.stderr || "").matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!times.length) return null;
  const [, h, m, s] = times.at(-1);
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function probeFromFfmpeg(file) {
  const result = spawnSync(ffmpegBin(), ["-hide_banner", "-i", file], { encoding: "utf8" });
  const text = result.stderr || "";
  const duration = text.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const streams = [...text.matchAll(/Stream #\d+:(\d+)[^:]*: (Video|Audio): (\w+)([^\n]*)/g)].map(([, index, type, codec, rest]) => {
    const size = rest.match(/, (\d{2,5})x(\d{2,5})/);
    const rate = rest.match(/(\d+) Hz/);
    return {
      index: Number(index),
      codec_type: type.toLowerCase(),
      codec_name: codec,
      width: size ? Number(size[1]) : undefined,
      height: size ? Number(size[2]) : undefined,
      sample_rate: rate ? rate[1] : undefined,
      channels: /stereo/.test(rest) ? 2 : /mono/.test(rest) ? 1 : undefined,
    };
  });
  if (!streams.length) return null;
  const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : NaN;
  return { format: { duration: Number.isFinite(seconds) ? String(seconds) : undefined }, streams, estimated: true };
}

function decodedStreamDuration(file, selector) {
  const result = spawnSync(ffmpegBin(), ["-hide_banner", "-nostats", "-i", file, "-map", selector, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const times = [...(result.stderr || "").matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!times.length) return null;
  const [, h, m, s] = times.at(-1);
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export function probe(file) {
  const ffprobe = ffprobeBin();
  if (!ffprobe) return probeFromFfmpeg(file);
  const result = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration,size:stream=index,codec_type,codec_name,width,height,duration,sample_rate,channels,r_frame_rate", "-of", "json", file], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout);
}

export function mediaDuration(file) {
  const info = probe(file);
  const declared = Number(info?.format?.duration);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return durationFromDecode(file);
}

export function streamDurations(file) {
  const info = probe(file);
  if (!info) return null;
  if (info.estimated) {
    const has = (type) => info.streams.some((s) => s.codec_type === type);
    return {
      video: has("video") ? decodedStreamDuration(file, "0:v:0") : null,
      audio: has("audio") ? decodedStreamDuration(file, "0:a:0") : null,
      format: Number(info.format?.duration) || null,
      streams: info.streams,
    };
  }
  const pick = (type) => {
    const stream = info.streams.find((s) => s.codec_type === type);
    if (!stream) return null;
    const value = Number(stream.duration ?? info.format?.duration);
    return Number.isFinite(value) ? value : null;
  };
  return { video: pick("video"), audio: pick("audio"), format: Number(info.format?.duration) || null, streams: info.streams };
}
