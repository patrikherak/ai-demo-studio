import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function merge(base, own) {
  const out = { ...base };
  for (const [key, value] of Object.entries(own)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

export function readSceneFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadScene(path, seen = new Set()) {
  const file = resolve(path);
  if (seen.has(file)) throw new Error(`circular "extends" at ${file}`);
  seen.add(file);
  const own = readSceneFile(file);
  if (!own.extends) return own;
  const { extends: parent, ...rest } = own;
  return merge(loadScene(resolve(dirname(file), parent), seen), rest);
}

export function sceneHash(scene) {
  const { audio, ...rest } = scene;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
}
