import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./env.mjs";
import { outputSize, renderFrames } from "./frames.mjs";
import { ffmpegBin, run } from "./media.mjs";

export const STAGE_KEYS = new Set([
  "layout", "url", "eyebrow", "title", "text", "bullets", "side", "phoneX", "panelWidth", "marginX", "marginY", "bandHeight",
  "chrome", "zoom", "zoomOn", "callouts", "calloutOverhang", "exit", "vars", "tilt", "theme", "titleSize", "titleAt",
  "safeArea", "statusBarHeight", "homeIndicatorHeight", "statusBarColor", "statusBarInk", "homeIndicatorColor", "statusTime",
]);

export function validateStage(stage) {
  return Object.keys(stage ?? {}).filter((key) => !STAGE_KEYS.has(key)).map((key) => `unknown stage key "${key}"`);
}

export async function renderStage({ scene, scenePath, raw, sidecar, startSec, totalSec, fps, out }) {
  const baseDir = dirname(scenePath);
  const framesDir = `${out}.frames`;
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  run(ffmpegBin(), [
    "-y", "-hide_banner", "-loglevel", "error", "-i", raw,
    "-vf", `trim=start=${startSec.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps}`,
    "-q:v", "2", join(framesDir, "%06d.jpg"),
  ]);
  const frameCount = readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).length;
  if (!frameCount) throw new Error(`no frames extracted from ${raw}`);
  const canvas = scene.canvas ?? outputSize();
  const viewport = sidecar.viewport ?? scene.viewport ?? { width: 1600, height: 1000 };
  const legendCopy = (e) => {
    const legend = Number.isInteger(e.step) ? scene.steps?.[e.step]?.legend : null;
    if (e.kind !== "legend" || !legend) return e;
    const { anchor: _anchor, wait: _wait, ...fields } = legend;
    return { ...e, ...fields };
  };
  const events = (sidecar.events ?? []).map((e) => ({ ...legendCopy(e), t: e.atMs / 1000 })).filter((e) => e.t > -1);
  const stageData = {
    canvas,
    viewport,
    fps,
    frameCount,
    framesUrl: pathToFileURL(framesDir).href,
    brandCss: scene.brand ? pathToFileURL(resolve(baseDir, scene.brand)).href : null,
    stage: scene.stage,
    events,
  };
  const result = await renderFrames({
    url: pathToFileURL(resolve(REPO_ROOT, "templates", "stage", "stage.html")).href,
    width: canvas.width,
    height: canvas.height,
    fps,
    durationSec: totalSec,
    out,
    crf: 14,
    init: `window.__STAGE__ = ${JSON.stringify(stageData)};`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.evaluate(async () => {
        const family = getComputedStyle(document.documentElement).getPropertyValue("--brand-font-heading").split(",")[0].trim();
        if (family) await Promise.all(["400", "500", "600"].map((w) => document.fonts.load(`${w} 40px ${family}`).catch(() => null)));
        await document.fonts.ready;
      });
    },
  });
  rmSync(framesDir, { recursive: true, force: true });
  return { ...result, frameCount, canvas };
}
