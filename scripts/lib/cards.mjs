import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./env.mjs";
import { outputSize, renderFrames } from "./frames.mjs";

export const CARD_TEMPLATES = ["title", "statement", "kinetic", "logo", "compare", "stats", "metric", "steps", "grid", "columns", "montage", "cta", "outro"];

function fileUrl(baseDir, value) {
  if (!value || /^(https?|file|data):/.test(value)) return value;
  return pathToFileURL(resolve(baseDir, value)).href;
}

export async function renderCardScene(scene, scenePath) {
  const baseDir = dirname(scenePath);
  const card = { ...scene.card, cues: scene.cues ?? [], words: scene.words ?? [] };
  const html = card.html ? resolve(baseDir, card.html) : resolve(REPO_ROOT, "templates", "cards", "card.html");
  if (!existsSync(html)) throw new Error(`card template ${html} does not exist`);
  if (!card.html && !CARD_TEMPLATES.includes(card.template)) throw new Error(`unknown card template "${card.template}" (use one of ${CARD_TEMPLATES.join(", ")} or card.html)`);
  for (const key of ["logo", "image"]) if (card[key]) card[key] = fileUrl(baseDir, card[key]);
  if (Array.isArray(card.items)) card.items = card.items.map((item) => (item?.image ? { ...item, image: fileUrl(baseDir, item.image) } : item));
  const brandCss = scene.brand ? fileUrl(baseDir, scene.brand) : null;
  const { width, height } = scene.canvas ?? outputSize();
  const fps = scene.fps ?? 30;
  const durationSec = Math.max(1, ((scene.minDurationMs ?? card.durationMs ?? 5000) + (scene.tailMs ?? 0)) / 1000);
  const unknownCue = JSON.stringify(card).match(/"cue:(\d+)/g)?.map((c) => Number(c.slice(5))).find((n) => n >= card.cues.length);
  if (unknownCue !== undefined) throw new Error(`card uses cue:${unknownCue} but the scene has ${card.cues.length} cue(s); run fit-scenes.mjs first`);
  const spoken = new Set(card.words.map((w) => w.w));
  const missingWord = [...JSON.stringify(scene.card).matchAll(/"word:([^":+-]+)/g)].map((m) => m[1].toLowerCase()).find((w) => !spoken.has(w));
  if (missingWord) throw new Error(`card uses word:${missingWord} but that word is not in the scene's narration timing; run narrate.mjs (word alignment) and fit-scenes.mjs`);
  const output = resolve(baseDir, scene.output);
  mkdirSync(dirname(output), { recursive: true });
  const locale = card.locale || process.env.NARRATION_LOCALE || process.env.NARRATION_LANGUAGE || process.env.DEMO_LANGUAGE || "en";
  const init = `window.__CARD__ = ${JSON.stringify(card)}; window.__BRAND_CSS__ = ${JSON.stringify(brandCss)}; window.__LOCALE__ = ${JSON.stringify(locale)};`;
  const result = await renderFrames({
    url: pathToFileURL(html).href,
    width,
    height,
    fps,
    durationSec,
    out: output,
    init,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.evaluate(async () => {
        const family = getComputedStyle(document.documentElement).getPropertyValue("--brand-font-heading").split(",")[0].trim();
        if (family) await Promise.all(["400", "500", "600"].map((w) => document.fonts.load(`${w} 64px ${family}`).catch(() => null)));
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
      });
    },
  });
  const sidecar = {
    scene: scene.id ?? null,
    output,
    kind: "card",
    template: card.html ? "custom" : card.template,
    startSec: 0,
    sceneSec: Number(durationSec.toFixed(3)),
    minDurationMs: scene.minDurationMs ?? 0,
    plannedOverrunSec: 0,
    misses: [],
    pageErrors: result.errors,
    msPerFrame: Number(result.msPerFrame.toFixed(1)),
    recordedAt: new Date().toISOString(),
  };
  writeFileSync(`${output}.json`, JSON.stringify(sidecar, null, 2));
  return sidecar;
}
