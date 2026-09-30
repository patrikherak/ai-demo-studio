#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fail, flagValue, hasFlag, loadEnv } from "./lib/env.mjs";

const HELP = `Generate synthetic stock photos for demo seed data (OpenAI Images API).

  node scripts/images.mjs <images.json> [--out-dir DIR] [--dry-run] [--force]

images.json:
  { "model": "gpt-image-1", "quality": "medium", "style": "appended to every prompt",
    "images": [ { "id": "guest-room", "prompt": "…", "size": "1536x1024" }, … ] }

Writes <out-dir>/<id>.png (default: next to images.json in images/) and
manifest.json. Results are cached by a hash of model, size, quality and prompt,
so re-running only generates what changed. Needs OPENAI_API_KEY.
Prompts must not ask for real people, brands, logos or readable text; the images
are synthetic and must be reported as such.`;

const args = process.argv.slice(2);
if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
loadEnv();

const specPath = resolve(args.find((a) => a.endsWith(".json")) ?? fail("images.json is required"));
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const outDir = resolve(flagValue(args, "--out-dir") ?? join(dirname(specPath), "images"));
const model = spec.model ?? process.env.IMAGE_MODEL ?? "gpt-image-1";
const quality = spec.quality ?? "medium";
const style = spec.style ? ` ${spec.style}` : "";
const images = spec.images ?? [];
if (!images.length) fail("images.json has no images");
for (const image of images) if (!image.id || !/^[A-Za-z0-9._-]+$/.test(image.id) || !image.prompt) fail(`image entries need an id ([A-Za-z0-9._-]) and a prompt`);

if (hasFlag(args, "--dry-run")) {
  console.log(JSON.stringify({ model, quality, images: images.length, outDir }, null, 2));
  process.exit(0);
}
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) fail("OPENAI_API_KEY is not set");

mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, "manifest.json");
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { images: [] };
const cached = new Map(previous.images.map((i) => [i.id, i]));
const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

async function generate(image) {
  const body = { model, prompt: image.prompt + style, size: image.size ?? "1536x1024", quality: image.quality ?? quality, n: 1 };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const json = await response.json();
      const item = json.data?.[0];
      if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
      if (item?.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer());
      fail(`no image in the response for "${image.id}"`);
    }
    const detail = (await response.text()).slice(0, 300);
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 4000 * attempt));
      continue;
    }
    fail(`OpenAI ${response.status} for image "${image.id}": ${detail}`);
  }
  return null;
}

const results = await Promise.all(images.map(async (image) => {
  const file = join(outDir, `${image.id}.png`);
  const key = hash(`${model}|${image.size ?? "1536x1024"}|${image.quality ?? quality}|${image.prompt}${style}`);
  const reusable = !hasFlag(args, "--force") && cached.get(image.id)?.key === key && existsSync(file);
  if (!reusable) writeFileSync(file, await generate(image));
  console.log(`${reusable ? "reused   " : "generated"} ${image.id}`);
  return { id: image.id, file: `${image.id}.png`, key, prompt: image.prompt, model, synthetic: true };
}));
writeFileSync(manifestPath, JSON.stringify({ model, images: results }, null, 2));
console.log(`manifest ${manifestPath}`);
