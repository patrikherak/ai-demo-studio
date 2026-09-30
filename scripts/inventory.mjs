#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { hasFlag } from "./lib/env.mjs";

const HELP = `Fast, read-only inventory of an unknown project: stack, how it runs, what it needs.

  node scripts/inventory.mjs <project-dir> [--json]

Detects package managers, frameworks, compose services, env templates, database
tooling, migrations, seeds, test/e2e setups and likely dev ports. It is a map for
where to read next, not a substitute for reading the README and the code.`;

const args = process.argv.slice(2);
if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
const root = resolve(args[0]);
const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", ".turbo", ".venv", "venv", "__pycache__", "vendor", "target", ".cache", "coverage"]);

function walk(dir, depth = 0, out = []) {
  if (depth > 4) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) walk(full, depth + 1, out);
    else out.push(relative(root, full));
  }
  return out;
}

const files = walk(root);
const has = (pattern) => files.filter((f) => pattern.test(f));
const read = (file) => { try { return readFileSync(join(root, file), "utf8"); } catch { return ""; } };

const report = { root, packages: [], frameworks: new Set(), databases: new Set(), services: [], envTemplates: [], migrations: [], seeds: [], e2e: [], ports: new Set(), makeTargets: [], docs: [], notes: [] };

for (const file of has(/(^|\/)package\.json$/)) {
  let pkg;
  try { pkg = JSON.parse(read(file)); } catch { continue; }
  const dir = file.replace(/\/?package\.json$/, "") || ".";
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const manager = existsSync(join(root, dir, "pnpm-lock.yaml")) || existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm"
    : existsSync(join(root, dir, "yarn.lock")) || existsSync(join(root, "yarn.lock")) ? "yarn"
    : existsSync(join(root, dir, "bun.lockb")) || existsSync(join(root, "bun.lock")) ? "bun" : "npm";
  const frameworkMap = { next: "Next.js", nuxt: "Nuxt", "@remix-run/react": "Remix", "@sveltejs/kit": "SvelteKit", astro: "Astro", vite: "Vite", "react-scripts": "Create React App", "@angular/core": "Angular", express: "Express", "@nestjs/core": "NestJS", fastify: "Fastify", hono: "Hono", "@tanstack/react-start": "TanStack Start", expo: "Expo", electron: "Electron" };
  for (const [dep, label] of Object.entries(frameworkMap)) if (deps[dep]) report.frameworks.add(label);
  const dbMap = { prisma: "Prisma", "@prisma/client": "Prisma", "drizzle-orm": "Drizzle", typeorm: "TypeORM", sequelize: "Sequelize", knex: "Knex", mongoose: "MongoDB (Mongoose)", pg: "PostgreSQL driver", postgres: "PostgreSQL driver", mysql2: "MySQL driver", "better-sqlite3": "SQLite", "@supabase/supabase-js": "Supabase", firebase: "Firebase", redis: "Redis", ioredis: "Redis" };
  for (const [dep, label] of Object.entries(dbMap)) if (deps[dep]) report.databases.add(label);
  report.packages.push({ dir, name: pkg.name ?? basename(dir), manager, scripts: Object.fromEntries(Object.entries(pkg.scripts ?? {}).filter(([k]) => /^(dev|start|build|seed|db:|migrate|prisma|drizzle|test|e2e|setup|bootstrap|preview|serve)/.test(k))) });
  for (const value of Object.values(pkg.scripts ?? {})) for (const m of String(value).matchAll(/(?:--port[ =]|-p\s+|PORT=)(\d{4,5})/g)) report.ports.add(m[1]);
}

const pyFiles = has(/(^|\/)(pyproject\.toml|requirements[^/]*\.txt|Pipfile)$/);
for (const file of pyFiles) {
  const text = read(file).toLowerCase();
  for (const [needle, label] of [["django", "Django"], ["flask", "Flask"], ["fastapi", "FastAPI"], ["streamlit", "Streamlit"], ["sqlalchemy", "SQLAlchemy"], ["alembic", "Alembic"], ["psycopg", "PostgreSQL driver"]]) {
    if (text.includes(needle)) (["SQLAlchemy", "Alembic", "PostgreSQL driver"].includes(label) ? report.databases : report.frameworks).add(label);
  }
}
if (has(/(^|\/)Gemfile$/).some((f) => /rails/.test(read(f)))) report.frameworks.add("Ruby on Rails");
if (has(/(^|\/)composer\.json$/).some((f) => /laravel/.test(read(f)))) report.frameworks.add("Laravel");
if (has(/(^|\/)go\.mod$/).length) report.frameworks.add("Go");
if (has(/(^|\/)Cargo\.toml$/).length) report.frameworks.add("Rust");
if (has(/(^|\/)manage\.py$/).length) report.frameworks.add("Django");

for (const file of has(/(^|\/)(docker-)?compose[^/]*\.ya?ml$/)) {
  const text = read(file);
  const services = [];
  let inServices = false;
  for (const line of text.split("\n")) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^\S/.test(line)) inServices = false;
    const service = inServices && line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (service) services.push(service[1]);
    const image = line.match(/image:\s*["']?([^"'\s]+)/);
    if (image) {
      if (/postgres|postgis|timescale/.test(image[1])) report.databases.add("PostgreSQL (compose)");
      if (/mysql|mariadb/.test(image[1])) report.databases.add("MySQL (compose)");
      if (/mongo/.test(image[1])) report.databases.add("MongoDB (compose)");
      if (/redis|valkey/.test(image[1])) report.databases.add("Redis (compose)");
      if (/minio|localstack/.test(image[1])) report.databases.add("Object storage (compose)");
      if (/mailpit|mailhog/.test(image[1])) report.notes.push(`local mail catcher in ${file}`);
    }
    for (const m of line.matchAll(/["']?(\d{4,5}):\d{2,5}["']?/g)) report.ports.add(m[1]);
  }
  report.services.push({ file, services });
}
if (has(/(^|\/)Dockerfile$/).length) report.notes.push(`Dockerfile(s): ${has(/(^|\/)Dockerfile$/).join(", ")}`);

report.envTemplates = has(/(^|\/)\.env[^/]*(example|sample|template|dist|defaults)[^/]*$|(^|\/)env\.example$/).map((file) => ({
  file,
  keys: read(file).split("\n").map((l) => l.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/)?.[1]).filter(Boolean),
}));
report.migrations = [...new Set(has(/(^|\/)(migrations?|drizzle|alembic|db\/migrate|prisma\/migrations)\//).map((f) => f.split("/").slice(0, -1).join("/")))].slice(0, 12);
report.seeds = has(/(seed|fixture|faker|factory|factories)[^/]*\.(ts|js|mjs|cjs|py|rb|php|sql|json)$/i).slice(0, 25);
if (has(/(^|\/)prisma\/schema\.prisma$/).length) report.databases.add("Prisma schema");
report.e2e = has(/(^|\/)(playwright\.config|cypress\.config|wdio\.conf)\.[a-z]+$/);
for (const file of has(/(^|\/)(vite|next|nuxt|astro|svelte)\.config\.[a-z]+$/)) for (const m of read(file).matchAll(/port:\s*(\d{4,5})/g)) report.ports.add(m[1]);
for (const file of has(/(^|\/)Makefile$/)) report.makeTargets.push(...read(file).split("\n").map((l) => l.match(/^([A-Za-z0-9_.-]+):(?!=)/)?.[1]).filter(Boolean).slice(0, 30));
report.docs = has(/(^|\/)(README|CONTRIBUTING|DEVELOPMENT|SETUP|INSTALL|AGENTS|CLAUDE)[^/]*\.md$/i).slice(0, 15);
if (has(/(^|\/)\.nvmrc$|(^|\/)\.node-version$/).length) report.notes.push(`node version pinned: ${read(has(/(^|\/)\.nvmrc$|(^|\/)\.node-version$/)[0]).trim()}`);
if (has(/(^|\/)\.tool-versions$/).length) report.notes.push(`.tool-versions: ${read(has(/(^|\/)\.tool-versions$/)[0]).trim().replace(/\n/g, "; ")}`);

const out = { ...report, frameworks: [...report.frameworks], databases: [...report.databases], ports: [...report.ports].sort() };
if (hasFlag(args, "--json")) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
const list = (items) => (items.length ? items.map((i) => `  - ${i}`).join("\n") : "  - (none found)");
console.log(`# Inventory: ${root}

frameworks: ${out.frameworks.join(", ") || "unknown"}
data: ${out.databases.join(", ") || "none detected"}
likely ports: ${out.ports.join(", ") || "unknown"}

## packages
${list(out.packages.map((p) => `${p.dir} (${p.manager}) ${p.name}: ${Object.entries(p.scripts).map(([k, v]) => `${k}=\`${v}\``).join("  ") || "no relevant scripts"}`))}

## compose services
${list(out.services.map((s) => `${s.file}: ${s.services.join(", ") || "?"}`))}

## env templates
${list(out.envTemplates.map((e) => `${e.file}: ${e.keys.join(", ")}`))}

## migrations
${list(out.migrations)}

## seeds / fixtures / factories
${list(out.seeds)}

## e2e configs
${list(out.e2e)}

## make targets
${list(out.makeTargets)}

## docs to read first
${list(out.docs)}

## notes
${list(out.notes)}`);
