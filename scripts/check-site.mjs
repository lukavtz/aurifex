#!/usr/bin/env node
// Static checks for site/. No dependencies. Run: node scripts/check-site.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");

const failures = [];
const notes = [];
const fail = (message) => failures.push(message);

function read(rel) {
  const path = join(site, rel);
  if (!existsSync(path)) {
    fail(`missing file: site/${rel}`);
    return "";
  }
  return readFileSync(path, "utf8");
}

/* ------------------------------------------------------------------ files */

for (const file of ["index.html", "styles.css", "i18n.js", "main.js", ".nojekyll"]) {
  if (!existsSync(join(site, file))) fail(`missing required file: site/${file}`);
}

const html = read("index.html");
const css = read("styles.css");
const i18nSource = read("i18n.js");

/* ------------------------------------------------------------------- i18n */

const start = i18nSource.indexOf("{");
const end = i18nSource.lastIndexOf("}");
if (start < 0 || end <= start) {
  fail("site/i18n.js: could not locate the dictionary object literal");
}

// site/i18n.js assigns a plain object to window.AURIFEX_I18N. Evaluate it in a
// throwaway context: it is local, dependency-free, and never touches the network.
let dict = {};
if (start >= 0 && end > start) {
  try {
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(i18nSource, sandbox, { timeout: 1000, filename: "site/i18n.js" });
    dict = sandbox.window.AURIFEX_I18N;
    if (!dict || typeof dict !== "object") throw new Error("window.AURIFEX_I18N was not assigned");
  } catch (error) {
    fail(`site/i18n.js: could not read the dictionary (${error.message})`);
  }
}

const languages = ["en", "ru", "zh"];
for (const lang of languages) {
  if (!dict[lang]) {
    fail(`site/i18n.js: missing locale "${lang}"`);
    continue;
  }
  const keys = Object.keys(dict[lang]);
  const empty = keys.filter(
    (key) => typeof dict[lang][key] !== "string" || !dict[lang][key].trim(),
  );
  if (empty.length) fail(`site/i18n.js: ${lang} has empty values for ${empty.join(", ")}`);
  if (!dict[lang]["meta.title"] || !dict[lang]["meta.description"]) {
    fail(`site/i18n.js: ${lang} is missing meta.title or meta.description`);
  }
}

const enKeys = Object.keys(dict.en ?? {}).toSorted();
for (const lang of languages.slice(1)) {
  const keys = Object.keys(dict[lang] ?? {}).toSorted();
  const missing = enKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !enKeys.includes(key));
  if (missing.length) fail(`site/i18n.js: ${lang} is missing keys: ${missing.join(", ")}`);
  if (extra.length) fail(`site/i18n.js: ${lang} has keys absent from en: ${extra.join(", ")}`);
}

const used = new Set();
for (const match of html.matchAll(/data-i18n(?:-alt|-label)?="([^"]+)"/g)) used.add(match[1]);
const unknown = [...used].filter((key) => !(key in (dict.en ?? {})));
if (unknown.length) fail(`site/index.html references unknown i18n keys: ${unknown.join(", ")}`);

const unused = enKeys.filter(
  // hero.copied is written by main.js after a successful clipboard write.
  (key) => !used.has(key) && !key.startsWith("meta.") && key !== "hero.copied",
);
if (unused.length) notes.push(`unused i18n keys (not rendered): ${unused.join(", ")}`);

/* ----------------------------------------------------------------- assets */

const localRefs = new Set();
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = match[1];
  if (/^(?:https?:|mailto:|#|data:)/.test(ref) || ref.startsWith("//")) continue;
  localRefs.add(ref.replace(/^\.\//, "").split("?")[0]);
}
for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
  const ref = match[1].trim();
  if (/^(?:data:|https?:)/.test(ref)) continue;
  localRefs.add(ref.replace(/^\.\//, ""));
}

for (const ref of localRefs) {
  if (!existsSync(join(site, ref))) fail(`referenced asset does not exist: site/${ref}`);
}

for (const ref of [
  "assets/aurifex-banner.webp",
  "assets/aurifex-banner.jpg",
  "assets/aurifex-avatar.webp",
  "assets/favicon.png",
]) {
  if (!existsSync(join(site, ref))) fail(`required brand asset is missing: site/${ref}`);
}

/* --------------------------------------------------- no external fetches */

for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)) {
  if (/^(?:https?:)?\/\//i.test(match[1])) fail(`external script URL is not allowed: ${match[1]}`);
}

for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
  const tag = match[0];
  const rel = (tag.match(/\brel="([^"]+)"/i) ?? [])[1]?.toLowerCase() ?? "";
  if (rel.includes("canonical")) continue;
  const href = (tag.match(/\bhref="([^"]+)"/i) ?? [])[1] ?? "";
  if (/^(?:https?:)?\/\//i.test(href)) {
    fail(`external <link rel="${rel}"> is not allowed: ${href}`);
  }
}

if (/@font-face/i.test(css))
  fail("site/styles.css: @font-face is not allowed (no remote or bundled fonts)");
if (/@import\s+url\(\s*["']?https?:/i.test(css))
  fail("site/styles.css: external @import is not allowed");
if (/url\(\s*["']?(?:https?:)?\/\//i.test(css))
  fail("site/styles.css: external url() is not allowed");
if (/url\(\s*["']?[^)]*(?:fonts\.googleapis|fonts\.gstatic)/i.test(css))
  fail("site/styles.css: remote fonts are not allowed");

/* --------------------------------------------------- document contract */

if (!/<html[^>]*\blang="en"/i.test(html))
  fail('site/index.html: <html lang="en"> is required as the default');
if (!/<meta[^>]+name="description"[^>]+content="[^"]{40,}"/i.test(html)) {
  fail("site/index.html: meta description is missing or too short");
}
if (!/<link[^>]+rel="canonical"[^>]+href="https:\/\/lukavtz\.github\.io\/aurifex\/"/i.test(html)) {
  fail("site/index.html: canonical URL must be https://lukavtz.github.io/aurifex/");
}
const ogImage = (html.match(/property="og:image"\s+content="([^"]+)"/) ?? [])[1] ?? "";
if (ogImage !== "https://lukavtz.github.io/aurifex/assets/aurifex-banner.jpg") {
  fail(
    "site/index.html: og:image must be https://lukavtz.github.io/aurifex/assets/aurifex-banner.jpg",
  );
}
if (!/name="twitter:card"\s+content="summary_large_image"/.test(html)) {
  fail("site/index.html: twitter:card summary_large_image is required");
}
if (!/rel="icon"/.test(html)) fail("site/index.html: favicon link is required");
if (!/class="skip"/.test(html)) fail("site/index.html: skip link is required");
if (!/<main\b[^>]*\bid="main"/.test(html)) fail('site/index.html: <main id="main"> is required');
if (!/prefers-reduced-motion/.test(css))
  fail("site/styles.css: prefers-reduced-motion handling is required");
if (!/aria-pressed/.test(html) || !/data-lang="ru"/.test(html) || !/data-lang="zh"/.test(html)) {
  fail("site/index.html: keyboard language switcher with en/ru/zh is required");
}
if (!/aria-label="Aurifex gold monogram"|<img[^>]+alt=/.test(html)) {
  fail("site/index.html: images need alt text");
}

for (const installer of [
  "https://raw.githubusercontent.com/lukavtz/aurifex/main/install.sh",
  "https://raw.githubusercontent.com/lukavtz/aurifex/main/install.ps1",
]) {
  if (!html.includes(installer)) fail(`site/index.html: missing installer URL ${installer}`);
}

/* -------------------------------------------------------------- report */

if (notes.length) {
  for (const note of notes) console.log(`note  ${note}`);
}

if (failures.length) {
  console.error(`\ncheck-site: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  fail  ${failure}`);
  process.exit(1);
}

console.log(
  `check-site: ok · ${languages.length} locales · ${enKeys.length} keys · ${localRefs.size} local assets`,
);
