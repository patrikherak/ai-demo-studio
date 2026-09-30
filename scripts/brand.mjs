#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, flagValue, loadEnv } from "./lib/env.mjs";

const HELP = `Extract a brand kit (colours, fonts, logo, tone) from a public website.

  node scripts/brand.mjs <url> <out-dir> [--pages /,/product] [--viewport 1440x900]

Writes <out-dir>/brand.json, the header logo (as found and as a transparent,
tight logo.png for uploads and cards), section screenshots and brand.css with
CSS custom properties (--brand-*) that cards, legends and the stage renderer use.
Only logos in the page header are taken: logo strips of customers or partners
further down never belong in a video. Review brand.json: the palette is ranked by how much
visible area each colour covers, and the primary colour is the most used
saturated colour of buttons and links.`;

const args = process.argv.slice(2);
if (args.length < 2 || args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.includes("-h") || args.includes("--help") ? 0 : 1);
}
loadEnv();

const url = args[0];
const outDir = resolve(args[1]);
const pages = (flagValue(args, "--pages") ?? "/").split(",").map((p) => p.trim()).filter(Boolean);
const [vw, vh] = (flagValue(args, "--viewport") ?? "1440x900").split("x").map(Number);
mkdirSync(outDir, { recursive: true });

const require = createRequire(import.meta.url);
const playwrightEntry = process.env.PLAYWRIGHT_DIR
  ? require.resolve("playwright", { paths: [process.env.PLAYWRIGHT_DIR] })
  : "playwright";
const { chromium } = require(playwrightEntry);

const COLLECT = () => {
  const toHex = (value) => {
    const m = value && value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean);
    if (Number(a) < 0.35) return null;
    return "#" + [r, g, b].map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
  };
  const area = new Map();
  const text = new Map();
  const accents = new Map();
  const add = (map, key, weight) => { if (key) map.set(key, (map.get(key) ?? 0) + weight); };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const size = Math.min(r.width * r.height, innerWidth * innerHeight);
    add(area, toHex(cs.backgroundColor), size);
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (direct) add(text, toHex(cs.color), el.textContent.trim().length);
    const interactive = el.matches("a, button, [role=button], input[type=submit]");
    if (interactive) {
      add(accents, toHex(cs.backgroundColor), 3);
      add(accents, toHex(cs.color), 1);
      add(accents, toHex(cs.borderTopColor), cs.borderTopWidth !== "0px" ? 1 : 0);
    }
  }
  const rank = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([hex, weight]) => ({ hex, weight: Math.round(weight) }));
  const fontOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { selector: sel, family: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, transform: cs.textTransform };
  };
  const rootVars = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.selectorText === ":root" || rule.selectorText === "html") {
        for (const prop of rule.style) if (prop.startsWith("--")) rootVars[prop] = rule.style.getPropertyValue(prop).trim();
      }
    }
  }
  const fontFaces = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.constructor.name === "CSSFontFaceRule") {
        fontFaces.push({ family: rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim(), weight: rule.style.getPropertyValue("font-weight"), style: rule.style.getPropertyValue("font-style"), src: rule.style.getPropertyValue("src"), base: sheet.href ?? location.href });
      }
    }
  }
  const stylesheetLinks = [...document.querySelectorAll("link[rel=stylesheet]")].map((l) => l.href).filter((h) => /fonts\.(googleapis|bunny)|typekit|use\.typekit|fonts\.com/.test(h));
  const logoCandidates = [...document.querySelectorAll("header img, header svg, nav img, nav svg, a[href='/'] img, a[href='/'] svg, img[alt*=logo i], img[src*=logo i], [class*=logo i] img, [class*=logo i] svg, svg[class*=logo i]")]
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), src: el.currentSrc || el.getAttribute("src") || null, svg: el.tagName.toLowerCase() === "svg" ? el.outerHTML : null, alt: el.getAttribute("alt"), box: { x: r.x, y: r.y, w: r.width, h: r.height } };
    })
    .filter((logo) => logo.box.y < 160 && logo.box.h < 140)
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const meta = (name) => document.querySelector(`meta[name='${name}'], meta[property='${name}']`)?.getAttribute("content") ?? null;
  const headings = [...document.querySelectorAll("h1, h2, h3")].filter(visible).map((h) => ({ level: h.tagName.toLowerCase(), text: h.textContent.trim().replace(/\s+/g, " ") })).filter((h) => h.text).slice(0, 40);
  const buttons = [...document.querySelectorAll("a, button")].filter(visible).map((b) => b.textContent.trim().replace(/\s+/g, " ")).filter((t) => t && t.length < 40);
  const radius = (() => {
    const values = new Map();
    for (const el of document.querySelectorAll("a, button, img, [class*=card i]")) {
      const v = getComputedStyle(el).borderTopLeftRadius;
      if (v && v !== "0px") values.set(v, (values.get(v) ?? 0) + 1);
    }
    return [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v]) => v);
  })();
  return {
    title: document.title,
    description: meta("description") ?? meta("og:description"),
    ogImage: meta("og:image"),
    themeColor: meta("theme-color"),
    lang: document.documentElement.lang || null,
    favicon: document.querySelector("link[rel~=icon]")?.href ?? null,
    palette: { area: rank(area).slice(0, 12), text: rank(text).slice(0, 8), accents: rank(accents).slice(0, 10) },
    fonts: { body: fontOf("body"), h1: fontOf("h1"), h2: fontOf("h2"), button: fontOf("a[class*=button i], button, a[class*=btn i]"), faces: fontFaces.slice(0, 30), stylesheets: stylesheetLinks },
    radius,
    rootVars,
    logos: logoCandidates.slice(0, 2),
    headings,
    buttons: [...new Set(buttons)].slice(0, 40),
  };
};

const saturation = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const page = await context.newPage();
const fontRequests = new Set();
const crossOriginStylesheets = new Set();
page.on("request", (request) => {
  const type = request.resourceType();
  if (type === "font" || /\.(woff2?|otf|ttf)(\?|$)/.test(request.url())) fontRequests.add(request.url());
  if (type === "stylesheet" && new URL(request.url()).origin !== new URL(url).origin) crossOriginStylesheets.add(request.url());
});
const results = [];
for (const [index, path] of pages.entries()) {
  const target = new URL(path, url).href;
  await page.goto(target, { waitUntil: "networkidle", timeout: 45000 }).catch(() => page.goto(target, { waitUntil: "load" }));
  await page.waitForTimeout(1200);
  for (const text of ["Accept", "Accept all", "Alle akzeptieren", "Akzeptieren", "OK", "Tout accepter", "Accetta"]) {
    const button = page.getByRole("button", { name: text, exact: true });
    if (await button.count().catch(() => 0)) { await button.first().click().catch(() => {}); break; }
  }
  await page.screenshot({ path: join(outDir, `page-${index + 1}-fold.png`) });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  let section = 0;
  for (let y = 0; y < height && section < 24; y += Math.round(vh * 0.85)) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(700);
    section += 1;
    await page.screenshot({ path: join(outDir, `page-${index + 1}-section-${String(section).padStart(2, "0")}.jpg`), type: "jpeg", quality: 80 });
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
  results.push({ url: target, ...(await page.evaluate(COLLECT)) });
}

const first = results[0];
const logoFiles = [];
for (const [index, logo] of first.logos.entries()) {
  if (logo.svg) {
    const file = join(outDir, `logo-${index + 1}.svg`);
    writeFileSync(file, logo.svg.includes("xmlns") ? logo.svg : logo.svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"'));
    logoFiles.push(file);
  } else if (logo.src) {
    const response = await context.request.get(new URL(logo.src, first.url).href).catch(() => null);
    if (response?.ok()) {
      const type = response.headers()["content-type"] ?? "";
      const ext = type.includes("svg") ? "svg" : type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("jpeg") ? "jpg" : (logo.src.split("?")[0].split(".").pop() || "bin");
      const file = join(outDir, `logo-${index + 1}.${ext}`);
      writeFileSync(file, await response.body());
      logoFiles.push(file);
    }
  }
}
let logoPng = null;
if (logoFiles.length) {
  const logoPage = await context.newPage();
  await logoPage.setViewportSize({ width: 1600, height: 600 });
  const holder = join(outDir, ".logo.html");
  writeFileSync(holder, `<body style="margin:0;background:transparent"><img id="logo" src="${pathToFileURL(logoFiles[0]).href}" style="height:360px;width:auto;display:block"></body>`);
  await logoPage.goto(pathToFileURL(holder).href);
  const shown = await logoPage.locator("#logo").evaluate((img) => img.decode().then(() => img.naturalWidth > 0).catch(() => false)).catch(() => false);
  if (shown) {
    logoPng = join(outDir, "logo.png");
    await logoPage.locator("#logo").screenshot({ path: logoPng, omitBackground: true });
  }
  await logoPage.close();
  rmSync(holder, { force: true });
}
await browser.close();

const merge = (key) => {
  const map = new Map();
  for (const r of results) for (const { hex, weight } of r.palette[key]) map.set(hex, (map.get(hex) ?? 0) + weight);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
};
const areaColors = merge("area");
const textColors = merge("text");
const accentColors = merge("accents");
const vars = first.rootVars;
const pickVar = (...names) => {
  for (const name of names) {
    const value = vars[`--${name}`];
    if (value && /^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  }
  return null;
};
const background = pickVar("bg", "background", "color-bg", "color-background") ?? areaColors.find((c) => luminance(c) > 0.85) ?? areaColors[0] ?? "#ffffff";
const ink = pickVar("ink", "text", "foreground", "color-text", "color-fg") ?? textColors[0] ?? "#111111";
const primary = pickVar("accent", "primary", "brand", "color-primary", "color-accent") ?? accentColors.find((c) => saturation(c) > 0.3 && c !== background) ?? areaColors.find((c) => saturation(c) > 0.3) ?? ink;
const surfaces = areaColors.filter((c) => c !== background && c !== primary).slice(0, 4);
const varColors = Object.values(vars).map((v) => v.toLowerCase()).filter((v) => /^#[0-9a-f]{6}$/.test(v));
const candidates = [...new Set([...varColors, ...accentColors, ...areaColors, ...textColors])];
const hue = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (!delta) return 0;
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a, b) => Math.min(Math.abs(hue(a) - hue(b)), 360 - Math.abs(hue(a) - hue(b)));
const accents = [];
for (const c of candidates) {
  if (saturation(c) > 0.3 && luminance(c) > 0.04 && luminance(c) < 0.5 && [primary, ...accents].every((other) => hueGap(c, other) > 28)) accents.push(c);
}
const secondary = accents[0] ?? surfaces[0] ?? primary;
const tintFor = (color) => candidates.filter((c) => luminance(c) > 0.72 && saturation(c) > 0.04 && c !== background).sort((a, b) => hueGap(a, color) - hueGap(b, color))[0];
const tints = [primary, ...accents].map(tintFor).filter(Boolean).filter((c, i, all) => all.indexOf(c) === i);
const dark = [...candidates].filter((c) => luminance(c) < 0.03).sort((a, b) => luminance(a) - luminance(b))[0] ?? ink;
const muted = pickVar("muted", "text-muted", "color-muted") ?? textColors.find((c) => c !== ink && luminance(c) > 0.08 && luminance(c) < 0.45) ?? "#6b7280";
const surface = pickVar("surface", "card", "color-surface") ?? "#ffffff";
const surface2 = pickVar("bg-2", "surface-2", "muted-bg") ?? surfaces.find((c) => luminance(c) > 0.7 && c !== surface) ?? "#ececec";
const family = (f) => f?.family ?? "system-ui, sans-serif";

const brand = {
  source: url,
  pages: results.map((r) => r.url),
  name: first.title,
  description: first.description,
  lang: first.lang,
  colors: { background, ink, primary, secondary, accents: accents.slice(0, 4), tints: tints.slice(0, 4), dark, muted, surface, surface2, palette: { area: areaColors.slice(0, 12), text: textColors.slice(0, 8), accents: accentColors.slice(0, 10) } },
  fonts: { heading: family(first.fonts.h1 ?? first.fonts.h2), body: family(first.fonts.body), button: family(first.fonts.button), detail: first.fonts, stylesheets: [...new Set([...results.flatMap((r) => r.fonts.stylesheets), ...crossOriginStylesheets])], files: [...fontRequests] },
  radius: first.radius,
  rootVars: first.rootVars,
  logos: logoFiles.map((f) => f.slice(outDir.length + 1)),
  logo: logoPng ? "logo.png" : null,
  favicon: first.favicon,
  ogImage: first.ogImage,
  copy: { headings: results.flatMap((r) => r.headings), buttons: [...new Set(results.flatMap((r) => r.buttons))].slice(0, 60) },
};
writeFileSync(join(outDir, "brand.json"), JSON.stringify(brand, null, 2));

const fontFaceCss = results[0].fonts.faces
  .filter((f) => f.src)
  .map((f) => {
    const src = f.src.replace(/url\((['"]?)([^'")]+)\1\)/g, (_, q, u) => `url("${new URL(u, f.base).href}")`);
    return `@font-face { font-family: "${f.family}"; ${f.weight ? `font-weight: ${f.weight};` : ""} ${f.style ? `font-style: ${f.style};` : ""} src: ${src}; font-display: block; }`;
  })
  .join("\n");
const css = [
  ...brand.fonts.stylesheets.filter((href) => /font|typekit/i.test(new URL(href).host + new URL(href).pathname)).map((href) => `@import url("${href}");`),
  fontFaceCss,
  ":root {",
  `  --brand-bg: ${background};`,
  `  --brand-ink: ${ink};`,
  `  --brand-primary: ${primary};`,
  `  --brand-secondary: ${secondary};`,
  `  --brand-accent-2: ${accents[0] ?? secondary};`,
  `  --brand-accent-3: ${accents[1] ?? accents[0] ?? secondary};`,
  `  --brand-tint-1: ${tints[0] ?? "#f1f1f1"};`,
  `  --brand-tint-2: ${tints[1] ?? tints[0] ?? "#f1f1f1"};`,
  `  --brand-tint-3: ${tints[2] ?? tints[0] ?? "#f1f1f1"};`,
  `  --brand-muted: ${muted};`,
  `  --brand-dark: ${dark};`,
  `  --brand-surface: ${surface};`,
  `  --brand-surface-2: ${surface2};`,
  `  --brand-radius-card: ${["--r-lg", "--radius-lg", "--radius"].map((k) => vars[k]).find((v) => v && /px|rem/.test(v)) ?? brand.radius.find((r) => r !== "999px" && r !== "50%") ?? "18px"};`,
  `  --brand-font-heading: ${brand.fonts.heading};`,
  `  --brand-font-body: ${brand.fonts.body};`,
  `  --brand-radius: ${brand.radius[0] ?? "12px"};`,
  "}",
].join("\n");
writeFileSync(join(outDir, "brand.css"), css + "\n");
console.log(JSON.stringify({ out: outDir, primary, secondary, background, ink, heading: brand.fonts.heading, body: brand.fonts.body, logos: brand.logos }, null, 2));
