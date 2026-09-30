#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { renderCardScene } from "./lib/cards.mjs";
import { fail, loadEnv } from "./lib/env.mjs";
import { encoderArgs, loadChromium } from "./lib/frames.mjs";
import { ffmpegBin, run } from "./lib/media.mjs";
import { loadScene, sceneHash } from "./lib/scene.mjs";
import { validateStage } from "./lib/stage.mjs";

const HELP = `Record one scene of a product demo with Playwright.

  node scripts/record.mjs <scene.json>

Writes the raw video to scene.output (.mp4 or .webm) and a sidecar <output>.json
with startSec (where the scene begins after loading), sceneSec, every miss and the
focus events (clicks, typing, highlights, legends) that the stage compositor uses,
and a sceneHash so unchanged scenes can be skipped (scripts/produce.mjs).
"hooks": { "before": "cmd", "after": "cmd" } run shell commands in the scene's folder
before and after the take, e.g. to undo a booking the previous take created.
Exit code 2 = a selector was not found (the take is not usable in strict mode).

capture "screencast" (default) grabs full-quality frames over CDP at the scene's
deviceScaleFactor; "video" uses Playwright's built-in recorder (1 Mbit/s VP8).
A scene with "card" is not a browser recording: it renders an animated title,
stats, comparison, steps, grid, columns or call-to-action card instead.
The scene format is documented in skills/record-scenes/SKILL.md.`;

const STEP_KEYS = new Set([
  "goto", "waitFor", "waitForGone", "waitMs", "mark", "click", "moveTo", "hover", "fill", "type", "press",
  "scrollTo", "scrollY", "scroll", "legend", "highlight", "screenshot", "evaluate", "note", "focus", "upload",
]);
const SCENE_KEYS = new Set([
  "id", "title", "baseUrl", "output", "viewport", "videoSize", "deviceScaleFactor", "colorScheme", "locale",
  "timezoneId", "storageState", "saveStorageState", "cookies", "localStorage", "hide", "mask", "maskText",
  "initScript", "accent", "setup", "authUrl", "steps", "minDurationMs", "tailMs", "timeoutMs", "strict",
  "headless", "narration", "narrationGapMs", "leadInMs", "reserveMs", "audio", "clip", "notes",
  "capture", "captureQuality", "fps", "brand", "stage", "card", "canvas", "theme", "routes", "cues", "words", "beatMs", "sfx", "sfxCues", "hooks",
]);

const args = process.argv.slice(2);
if (!args.length || args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
loadEnv();

const scenePath = resolve(args[0]);
const scene = loadScene(scenePath);
const problems = [];
for (const key of Object.keys(scene)) if (!SCENE_KEYS.has(key)) problems.push(`unknown scene key "${key}"`);
for (const [index, step] of [...(scene.setup ?? []), ...(scene.steps ?? [])].entries()) {
  for (const key of Object.keys(step)) if (!STEP_KEYS.has(key) && !["timeoutMs", "afterMs", "optional"].includes(key)) problems.push(`step ${index}: unknown key "${key}"`);
}
if (!scene.output) problems.push("scene.output is required");
if (!scene.card && (!Array.isArray(scene.steps) || !scene.steps.length)) problems.push("scene.steps must be a non-empty array");
if (scene.capture && !["screencast", "video"].includes(scene.capture)) problems.push(`capture must be "screencast" or "video"`);
problems.push(...validateStage(scene.stage));
if (problems.length) fail(`invalid scene ${scenePath}\n  ${problems.join("\n  ")}`);

function runHook(name) {
  const command = scene.hooks?.[name];
  if (!command) return;
  const result = spawnSync("sh", ["-c", command], { cwd: dirname(scenePath), stdio: "inherit", env: process.env });
  if (result.status !== 0) fail(`hooks.${name} exited ${result.status}: ${command}`);
}
runHook("before");

if (scene.card) {
  const sidecar = await renderCardScene(scene, scenePath).catch((error) => fail(`card ${scene.id ?? scenePath}: ${error.message}`));
  writeFileSync(`${sidecar.output}.json`, JSON.stringify({ ...sidecar, sceneHash: sceneHash(scene) }, null, 2));
  console.log(`VIDEO ${sidecar.output} card=${sidecar.template} scene=${sidecar.sceneSec}s misses=0 ${sidecar.msPerFrame} ms/frame`);
  if (sidecar.pageErrors.length) console.log(`WARN page errors: ${sidecar.pageErrors.slice(0, 3).join(" | ")}`);
  runHook("after");
  process.exit(0);
}

const chromium = loadChromium();

const baseDir = dirname(scenePath);
const at = (p) => (p ? resolve(baseDir, p) : p);
const output = at(scene.output);
const viewport = scene.viewport ?? { width: 1600, height: 1000 };
const timeoutMs = scene.timeoutMs ?? 8000;
const strict = scene.strict !== false;
const accent = scene.accent ?? "#2563eb";
const theme = {
  font: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
  background: "rgba(15,23,42,.94)",
  color: "#fff",
  muted: "rgba(255,255,255,.92)",
  radius: "14px",
  ...(scene.theme ?? {}),
};
const capture = scene.capture ?? process.env.DEMO_CAPTURE ?? "screencast";
const staged = Boolean(scene.stage);
const misses = [];
const screenshots = [];
const events = [];
let currentStep = { index: null, target: null };
const recordEvent = (kind, data = {}) => events.push({ kind, at: Date.now(), step: currentStep.index, target: currentStep.target ?? undefined, ...data });
const stepTarget = (step) => step.waitFor ?? step.waitForGone ?? step.click ?? step.moveTo ?? step.hover ?? step.scrollTo
  ?? step.fill?.selector ?? step.type?.selector ?? step.upload?.click ?? step.upload?.selector ?? step.highlight?.selector
  ?? step.highlight ?? step.focus?.selector ?? (typeof step.focus === "string" ? step.focus : null) ?? step.goto ?? null;
mkdirSync(dirname(output), { recursive: true });

const urlFor = (target) => (/^https?:\/\//.test(target) ? target : (scene.baseUrl ?? "") + target);

const CURSOR_JS = `(() => {
  if (window.__demoCursor) return; window.__demoCursor = true;
  const add = () => {
    if (document.getElementById("__demo_cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.style.cssText = "position:fixed;top:0;left:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;will-change:transform;";
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 3l14 7-6 1.6L9.6 18 5 3z" fill="${accent}" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const move = (x, y) => { c.style.transform = "translate(" + x + "px," + y + "px)"; };
    window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY), true);
    move(Math.round(innerWidth * 0.5), Math.round(innerHeight * 0.6));
  };
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
  setInterval(add, 500);
})();`;

const hideJs = (selectors) => `(() => {
  const css = ${JSON.stringify(selectors)}.map((s) => s + "{display:none !important;visibility:hidden !important;}").join("\\n");
  const add = () => {
    if (document.getElementById("__demo_hide")) return;
    const style = document.createElement("style");
    style.id = "__demo_hide";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.documentElement) add();
  document.addEventListener("DOMContentLoaded", add);
  setInterval(add, 400);
})();`;

const maskJs = (masks, replacements) => `(() => {
  const masks = ${JSON.stringify(masks)};
  const replacements = ${JSON.stringify(replacements)};
  const apply = () => {
    for (const m of masks) document.querySelectorAll(m.selector).forEach((el) => { if (el.textContent !== m.text) el.textContent = m.text; });
    if (!replacements.length || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let text = node.nodeValue;
      for (const r of replacements) if (text.includes(r.find)) text = text.split(r.find).join(r.replace);
      if (text !== node.nodeValue) node.nodeValue = text;
    }
  };
  document.addEventListener("DOMContentLoaded", apply);
  setInterval(apply, 250);
})();`;

const localStorageJs = (origin, entries) => `(() => {
  if (location.origin !== ${JSON.stringify(origin)}) return;
  const entries = ${JSON.stringify(entries)};
  for (const [k, v] of Object.entries(entries)) { try { localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch {} }
})();`;

async function prepareContext(context) {
  await context.addInitScript(CURSOR_JS);
  if (scene.hide?.length) await context.addInitScript(hideJs(scene.hide));
  if (scene.mask?.length || scene.maskText?.length) await context.addInitScript(maskJs(scene.mask ?? [], scene.maskText ?? []));
  if (scene.localStorage && scene.baseUrl) await context.addInitScript(localStorageJs(new URL(scene.baseUrl).origin, scene.localStorage));
  if (scene.initScript) await context.addInitScript(scene.initScript);
  if (scene.cookies?.length) await context.addCookies(scene.cookies.map((c) => (c.url || c.domain ? c : { ...c, url: scene.baseUrl })));
}

let cursor = { x: viewport.width * 0.5, y: viewport.height * 0.6 };

async function glide(page, x, y) {
  const steps = 24;
  const from = cursor;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(from.x + (x - from.x) * ease, from.y + (y - from.y) * ease);
    await page.waitForTimeout(14);
  }
  cursor = { x, y };
}

const visible = (page, selector) => page.locator(selector).filter({ visible: true }).first();

async function locate(page, selector, stepTimeout) {
  const locator = visible(page, selector);
  await locator.waitFor({ state: "visible", timeout: stepTimeout });
  await locator.scrollIntoViewIfNeeded({ timeout: stepTimeout });
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box");
  return { locator, box, center: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

async function showLegend(page, legend) {
  const { title = "", text = "", position = "bottom", ms = 2600 } = legend;
  await page.evaluate(({ title, text, position, ms, theme }) => {
    document.getElementById("__demo_legend")?.remove();
    const wrap = document.createElement("div");
    wrap.id = "__demo_legend";
    const pos = {
      bottom: "left:50%;bottom:32px;transform:translateX(-50%);",
      top: "left:50%;top:32px;transform:translateX(-50%);",
      "bottom-left": "left:24px;bottom:28px;",
      "bottom-right": "right:24px;bottom:28px;",
      "top-left": "left:24px;top:28px;",
      "top-right": "right:24px;top:28px;",
    }[position] ?? "left:50%;bottom:32px;transform:translateX(-50%);";
    wrap.style.cssText = "position:fixed;" + pos + "z-index:2147483646;max-width:min(460px,84vw);"
      + "background:" + theme.background + ";color:" + theme.color + ";padding:14px 18px;border-radius:" + theme.radius + ";"
      + "box-shadow:0 18px 40px -12px rgba(0,0,0,.5);font-family:" + theme.font + ";"
      + "opacity:0;transition:opacity .35s;";
    if (title) {
      const h = document.createElement("div");
      h.style.cssText = "font-weight:700;font-size:15px;margin-bottom:4px;";
      h.textContent = title;
      wrap.appendChild(h);
    }
    const body = document.createElement("div");
    body.style.cssText = "font-size:13.5px;line-height:1.5;color:" + theme.muted + ";";
    body.textContent = text;
    wrap.appendChild(body);
    document.documentElement.appendChild(wrap);
    requestAnimationFrame(() => { wrap.style.opacity = "1"; });
    setTimeout(() => { wrap.style.opacity = "0"; setTimeout(() => wrap.remove(), 400); }, ms);
  }, { title, text, position, ms, theme });
  await page.waitForTimeout(ms + 450);
}

async function showHighlight(page, highlight, stepTimeout) {
  const { selector, ms = 2200 } = typeof highlight === "string" ? { selector: highlight } : highlight;
  const { box } = await locate(page, selector, stepTimeout);
  recordEvent("highlight", { box, ms });
  await page.evaluate(({ box, ms, accent }) => {
    document.getElementById("__demo_highlight")?.remove();
    const ring = document.createElement("div");
    ring.id = "__demo_highlight";
    ring.style.cssText = "position:fixed;left:" + (box.x - 6) + "px;top:" + (box.y - 6) + "px;width:" + (box.width + 12)
      + "px;height:" + (box.height + 12) + "px;z-index:2147483645;border:3px solid " + accent + ";border-radius:14px;"
      + "pointer-events:none;box-shadow:0 0 0 6px " + accent + "2e;opacity:0;transition:opacity .3s;";
    document.documentElement.appendChild(ring);
    requestAnimationFrame(() => { ring.style.opacity = "1"; });
    setTimeout(() => { ring.style.opacity = "0"; setTimeout(() => ring.remove(), 350); }, ms);
  }, { box, ms, accent });
  await page.waitForTimeout(ms + 380);
}

async function runStep(page, step, phase) {
  const stepTimeout = step.timeoutMs ?? timeoutMs;
  const record = phase === "record";
  if (step.goto != null) {
    if (record) recordEvent("navigate", { url: step.goto });
    await page.goto(urlFor(step.goto), { waitUntil: "domcontentloaded", timeout: Math.max(stepTimeout, 30000) });
  }
  if (step.waitFor) await visible(page, step.waitFor).waitFor({ state: "visible", timeout: stepTimeout });
  if (step.waitForGone) await page.locator(step.waitForGone).first().waitFor({ state: "hidden", timeout: stepTimeout });
  if (step.waitMs) await page.waitForTimeout(step.waitMs);
  if (step.scrollTo) {
    if (record) recordEvent("scroll");
    await visible(page, step.scrollTo).scrollIntoViewIfNeeded({ timeout: stepTimeout });
    await page.waitForTimeout(500);
  }
  if (step.scrollY != null) {
    if (record) recordEvent("scroll");
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), step.scrollY);
    await page.waitForTimeout(800);
  }
  if (step.scroll) {
    if (record) recordEvent("scroll");
    const { container = null, x = 0, y = 0, ms = 900 } = step.scroll;
    await page.evaluate(({ container, x, y, ms }) => {
      const candidates = container ? [...document.querySelectorAll(container)].filter((e) => e.getClientRects().length) : [];
      const target = candidates.pop();
      if (target && typeof target.scrollToPoint === "function") return target.scrollToPoint(x, y, ms);
      (target ?? document.scrollingElement).scrollTo({ left: x, top: y, behavior: "smooth" });
      return null;
    }, { container, x, y, ms });
    await page.waitForTimeout(ms + 100);
  }
  if (step.focus !== undefined && record) {
    if (!step.focus || step.focus.reset) recordEvent("reset");
    else {
      const { box } = await locate(page, typeof step.focus === "string" ? step.focus : step.focus.selector, stepTimeout);
      recordEvent("focus", { box, scale: step.focus.scale, holdMs: step.focus.holdMs });
    }
  }
  if (step.moveTo || step.hover) {
    const { center } = await locate(page, step.moveTo ?? step.hover, stepTimeout);
    if (phase === "record") await glide(page, center.x, center.y);
    else await page.mouse.move(center.x, center.y);
  }
  if (step.click) {
    const { center, box } = await locate(page, step.click, stepTimeout);
    if (record) {
      await glide(page, center.x, center.y);
      await page.waitForTimeout(160);
      recordEvent("click", { box, point: center });
    } else await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(step.afterMs ?? (phase === "record" ? 1100 : 300));
  }
  if (step.fill) {
    const { locator } = await locate(page, step.fill.selector, stepTimeout);
    await locator.fill(String(step.fill.value ?? ""));
  }
  if (step.type) {
    const { locator, center, box } = await locate(page, step.type.selector, stepTimeout);
    if (record) {
      recordEvent("type", { box, point: center });
      await glide(page, center.x, center.y);
    }
    await locator.click();
    if (step.type.clear !== false) await locator.fill("");
    await page.keyboard.type(String(step.type.text ?? ""), { delay: step.type.delayMs ?? 55 });
  }
  if (step.upload) {
    const files = [].concat(step.upload.files ?? step.upload.file ?? []).map((f) => at(f));
    if (step.upload.click) {
      const { center, box } = await locate(page, step.upload.click, stepTimeout);
      if (record) {
        await glide(page, center.x, center.y);
        await page.waitForTimeout(160);
        recordEvent("click", { box, point: center });
      }
      const chooser = page.waitForEvent("filechooser", { timeout: stepTimeout });
      await page.mouse.click(center.x, center.y);
      await (await chooser).setFiles(files);
    } else {
      await page.locator(step.upload.selector ?? "input[type=file]").first().setInputFiles(files, { timeout: stepTimeout });
    }
    await page.waitForTimeout(step.afterMs ?? (record ? 900 : 300));
  }
  if (step.press) await page.keyboard.press(step.press);
  if (step.evaluate) await page.evaluate(step.evaluate);
  if (step.legend && record) {
    const legend = step.legend;
    const anchor = legend.anchor ? (await locate(page, legend.anchor, stepTimeout)).box : undefined;
    const { anchor: _anchor, wait: _wait, ...fields } = legend;
    recordEvent("legend", { ...fields, ms: legend.ms ?? 2600, box: anchor });
    if (staged) await page.waitForTimeout((legend.ms ?? 2600) + (legend.wait === false ? -(legend.ms ?? 2600) : 450));
    else await showLegend(page, legend);
  }
  if (step.highlight && phase === "record") await showHighlight(page, step.highlight, stepTimeout);
  if (step.screenshot) {
    const file = at(step.screenshot);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    screenshots.push(file);
  }
}

async function runSteps(page, steps, phase, onMark) {
  for (const [index, step] of steps.entries()) {
    currentStep = { index: phase === "record" ? index : null, target: stepTarget(step) };
    try {
      await runStep(page, step, phase);
    } catch (error) {
      const target = stepTarget(step) ?? "";
      const miss = { phase, index, target, error: String(error.message).split("\n")[0] };
      if (!step.optional) misses.push(miss);
      console.log(`MISS ${phase}[${index}] ${JSON.stringify(target)} ${miss.error}`);
    }
    if (step.mark) onMark();
  }
}

const browser = await chromium.launch({ headless: scene.headless !== false });
const contextOptions = {
  viewport,
  deviceScaleFactor: scene.deviceScaleFactor ?? 1,
  colorScheme: scene.colorScheme ?? "light",
  locale: scene.locale,
  timezoneId: scene.timezoneId,
};

let storageState = scene.storageState ? at(scene.storageState) : undefined;
const setupSteps = [...(scene.authUrl ? [{ goto: scene.authUrl, waitMs: 800 }] : []), ...(scene.setup ?? [])];
if (setupSteps.length) {
  const setupContext = await browser.newContext({ ...contextOptions, storageState });
  await prepareContext(setupContext);
  const setupPage = await setupContext.newPage();
  await runSteps(setupPage, setupSteps, "setup", () => {});
  storageState = await setupContext.storageState();
  if (scene.saveStorageState) {
    const file = at(scene.saveStorageState);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(storageState, null, 2));
  }
  await setupContext.close();
}

async function applyRoutes(context) {
  for (const route of scene.routes ?? []) {
    await context.route(route.url, async (r) => {
      if (route.file) return r.fulfill({ path: at(route.file), contentType: route.contentType });
      if (route.body !== undefined) return r.fulfill({ status: route.status ?? 200, body: typeof route.body === "string" ? route.body : JSON.stringify(route.body), contentType: route.contentType ?? "application/json" });
      if (route.rewrite) return r.continue({ url: r.request().url().replace(new RegExp(route.rewrite.from), route.rewrite.to) });
      if (route.abort) return r.abort();
      return r.continue();
    });
  }
}

const context = await browser.newContext({
  ...contextOptions,
  storageState,
  ...(capture === "video" ? { recordVideo: { dir: resolve(dirname(output), ".rec"), size: scene.videoSize ?? viewport } } : {}),
});
await applyRoutes(context);
await prepareContext(context);
const page = await context.newPage();

const framesDir = `${output}.frames`;
const frames = [];
let cdp = null;
if (capture === "screencast") {
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(framesDir, `${String(frames.length + 1).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata?.timestamp ? metadata.timestamp * 1000 : Date.now() });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const dpr = scene.deviceScaleFactor ?? 1;
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: scene.captureQuality ?? 92,
    maxWidth: Math.round(viewport.width * dpr),
    maxHeight: Math.round(viewport.height * dpr),
    everyNthFrame: 1,
  });
}
const recordingStartedAt = Date.now();
let markedAt = null;
const mark = () => { if (markedAt === null) markedAt = Date.now(); };

function autoMarkIndex(sceneSteps) {
  if (sceneSteps.some((s) => s.mark)) return -1;
  const navigation = sceneSteps.findIndex((s) => s.goto != null);
  if (navigation < 0) return -1;
  const ready = sceneSteps.findIndex((s, i) => i >= navigation && (s.waitFor || s.waitForGone));
  return ready >= 0 ? ready : navigation;
}
const markIndex = autoMarkIndex(scene.steps);
const steps = scene.steps.map((s, i) => (i === markIndex ? { ...s, mark: true } : s));
if (!steps.some((s) => s.mark)) mark();
await runSteps(page, steps, "record", mark);
mark();

const minDurationMs = scene.minDurationMs ?? 0;
const elapsed = Date.now() - markedAt;
if (elapsed < minDurationMs) await page.waitForTimeout(minDurationMs - elapsed);
await page.waitForTimeout(scene.tailMs ?? 600);
const endedAt = Date.now();

let videoStartedAt = recordingStartedAt;
if (capture === "screencast") {
  await cdp.send("Page.stopScreencast").catch(() => {});
  await page.waitForTimeout(150);
  await context.close();
  await browser.close();
  if (!frames.length) fail(`no frames were captured for ${scenePath}`);
  videoStartedAt = frames[0].t;
  const list = join(framesDir, "frames.txt");
  const lines = [];
  for (const [i, frame] of frames.entries()) {
    const next = i + 1 < frames.length ? frames[i + 1].t : endedAt;
    lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, (next - frame.t) / 1000).toFixed(4)}`);
  }
  lines.push(`file '${frames.at(-1).file}'`);
  writeFileSync(list, lines.join("\n") + "\n");
  const fps = scene.fps ?? 30;
  run(ffmpegBin(), [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-fps_mode", "cfr",
    ...encoderArgs(output, { crf: 12, preset: "veryfast", fps }), output,
  ]);
  rmSync(framesDir, { recursive: true, force: true });
} else {
  const video = page.video();
  await context.close();
  await video.saveAs(output);
  await video.delete();
  await browser.close();
}

const sidecar = {
  scene: scene.id ?? null,
  output,
  capture,
  sceneHash: sceneHash(scene),
  viewport,
  deviceScaleFactor: scene.deviceScaleFactor ?? 1,
  startSec: Number((Math.max(0, markedAt - videoStartedAt) / 1000).toFixed(3)),
  sceneSec: Number(((endedAt - markedAt) / 1000).toFixed(3)),
  minDurationMs,
  plannedOverrunSec: minDurationMs && elapsed > minDurationMs ? Number(((elapsed - minDurationMs) / 1000).toFixed(3)) : 0,
  misses,
  screenshots,
  events: events.map(({ at: time, ...rest }) => ({ ...rest, atMs: time - markedAt })),
  capturedFrames: capture === "screencast" ? frames.length : undefined,
  recordedAt: new Date(recordingStartedAt).toISOString(),
};
writeFileSync(`${output}.json`, JSON.stringify(sidecar, null, 2));
console.log(`VIDEO ${output} start=${sidecar.startSec}s scene=${sidecar.sceneSec}s misses=${misses.length}`);
if (sidecar.plannedOverrunSec > 0) console.log(`WARN actions took ${sidecar.plannedOverrunSec}s longer than minDurationMs; check narration sync`);
runHook("after");
process.exit(strict && misses.length ? 2 : 0);
