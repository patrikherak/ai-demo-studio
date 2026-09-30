#!/usr/bin/env node
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";
import { loadChromium } from "./lib/frames.mjs";

const HELP = `Put screenshots side by side in one image to review them at a glance.

  node scripts/sheet.mjs <out.jpg> <image>... [--cols 6] [--height 520] [--labels]

Every image is scaled to the same height and laid out in rows of --cols; --labels
prints each file name under its image. Use it after probe scenes (screenshot steps)
to compare screens before scripting interactions.`;

const args = process.argv.slice(2);
if (args.length < 2 || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
loadEnv();
const positional = args.filter((a, i) => !a.startsWith("--") && !["--cols", "--height"].includes(args[i - 1]));
const [outArg, ...images] = positional;
if (!images.length) fail("at least one image is required");
const out = resolve(outArg);
const cols = Number(flagValue(args, "--cols") ?? 6);
const height = Number(flagValue(args, "--height") ?? 520);
const labels = hasFlag(args, "--labels");
mkdirSync(dirname(out), { recursive: true });
const html = resolve(dirname(out), `.sheet-${process.pid}.html`);
writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:12px;background:#e9e9e6;font:13px system-ui,sans-serif;display:grid;grid-template-columns:repeat(${cols},max-content);gap:12px;width:max-content}
figure{margin:0;background:#fff;padding:6px;border-radius:8px}img{display:block;height:${height}px;width:auto}figcaption{padding:6px 2px 0;color:#444}
</style>${images.map((img) => `<figure><img src="${pathToFileURL(resolve(img)).href}">${labels ? `<figcaption>${basename(img)}</figcaption>` : ""}</figure>`).join("")}`);
const chromium = loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(pathToFileURL(html).href);
await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null))));
await page.locator("body").screenshot({ path: out, type: out.endsWith(".png") ? "png" : "jpeg", quality: out.endsWith(".png") ? undefined : 85 });
await browser.close();
rmSync(html, { force: true });
console.log(`SHEET ${out} images=${images.length}`);
