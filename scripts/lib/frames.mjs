import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";
import { ffmpegBin } from "./media.mjs";

export function loadChromium() {
  const require = createRequire(import.meta.url);
  const entry = process.env.PLAYWRIGHT_DIR ? require.resolve("playwright", { paths: [process.env.PLAYWRIGHT_DIR] }) : "playwright";
  return require(entry).chromium;
}

export function outputSize(fallback = "1920x1080") {
  const [width, height] = (process.env.DEMO_OUTPUT || fallback).split("x").map(Number);
  return { width, height };
}

export function encoderArgs(file, { crf = 16, preset = "medium", fps = 30 } = {}) {
  if (/\.webm$/i.test(file)) return ["-c:v", "libvpx-vp9", "-crf", String(Math.max(crf, 18)), "-b:v", "0", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-pix_fmt", "yuv420p", "-r", String(fps)];
  return ["-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart"];
}

export async function renderFrames({ url, width, height, fps = 30, durationSec, out, crf = 16, init, prepare, quality = 94, log = true }) {
  const chromium = loadChromium();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.evaluate(() => document.fonts?.ready);
  if (prepare) await prepare(page);
  const hasFrame = await page.evaluate(() => typeof window.__frame === "function");
  if (!hasFrame) {
    await browser.close();
    throw new Error(`${url} does not define window.__frame(t, total)`);
  }
  const total = Math.max(1, Math.round(durationSec * fps));
  const ffmpeg = spawn(ffmpegBin(), [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    "-vf", "format=yuv420p", ...encoderArgs(out, { crf, fps }), out,
  ], { stdio: ["pipe", "inherit", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = once(ffmpeg, "close");
  const started = Date.now();
  for (let index = 0; index < total; index++) {
    const t = index / fps;
    await page.evaluate(([time, length]) => window.__frame(time, length), [t, durationSec]);
    const shot = await page.screenshot({ type: "jpeg", quality, animations: "allow", caret: "hide" });
    if (!ffmpeg.stdin.write(shot)) await once(ffmpeg.stdin, "drain");
    if (log && index > 0 && index % (fps * 10) === 0) process.stdout.write(`  frame ${index}/${total} (${((Date.now() - started) / index).toFixed(0)} ms/frame)\n`);
  }
  ffmpeg.stdin.end();
  const [code] = await exited;
  await browser.close();
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.trim().split("\n").slice(-4).join("\n")}`);
  return { frames: total, errors, msPerFrame: (Date.now() - started) / total };
}
