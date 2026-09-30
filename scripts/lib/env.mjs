import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  const quoted = value.match(/^(['"])(.*)\1$/);
  if (quoted) value = quoted[2];
  else value = value.replace(/\s+#.*$/, "");
  return [match[1], value];
}

export function loadEnv(files = [join(REPO_ROOT, ".env"), join(REPO_ROOT, ".tools", "env.sh")]) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const pair = parseLine(line);
      if (!pair || pair[1].includes("${")) continue;
      if (process.env[pair[0]] === undefined || process.env[pair[0]] === "") process.env[pair[0]] = pair[1];
    }
  }
  return process.env;
}

export function envNumber(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function flagValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function hasFlag(args, name) {
  return args.includes(name);
}

export function fail(message, code = 1) {
  console.error(`ERROR ${message}`);
  process.exit(code);
}
