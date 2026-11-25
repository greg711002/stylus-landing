// Static integrity check: every local asset referenced by HTML/CSS must exist,
// ids and anchors must resolve, every locale page must be fully translated and
// cross-linked, and the PWA shell (manifest, service worker, offline page,
// icons) must be wired up consistently.
//
// Usage: node check.mjs
import { readFile, stat, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const problems = [];
const checked = new Set();

// Single source of truth for the localized pages, mirroring the table in
// tools/make-locales.mjs: en lives at the site root, the rest in their own
// folder named after the language code.
const LOCALES = [
  { code: 'en', file: 'index.html', path: '/', og: 'en_US' },
  { code: 'pl', file: 'pl/index.html', path: '/pl/', og: 'pl_PL' },
  { code: 'ru', file: 'ru/index.html', path: '/ru/', og: 'ru_RU' },
  { code: 'zh', file: 'zh/index.html', path: '/zh/', og: 'zh_CN' },
  { code: 'es', file: 'es/index.html', path: '/es/', og: 'es_ES' },
  { code: 'hi', file: 'hi/index.html', path: '/hi/', og: 'hi_IN' },
  { code: 'pt', file: 'pt/index.html', path: '/pt/', og: 'pt_BR' },
  { code: 'bn', file: 'bn/index.html', path: '/bn/', og: 'bn_BD' },
  { code: 'fr', file: 'fr/index.html', path: '/fr/', og: 'fr_FR' },
  { code: 'de', file: 'de/index.html', path: '/de/', og: 'de_DE' },
  { code: 'ja', file: 'ja/index.html', path: '/ja/', og: 'ja_JP' },
  { code: 'ar', file: 'ar/index.html', path: '/ar/', og: 'ar_AR', rtl: true },
  { code: 'ko', file: 'ko/index.html', path: '/ko/', og: 'ko_KR' },
  { code: 'it', file: 'it/index.html', path: '/it/', og: 'it_IT' },
  { code: 'tr', file: 'tr/index.html', path: '/tr/', og: 'tr_TR' },
  { code: 'id', file: 'id/index.html', path: '/id/', og: 'id_ID' },
];

// Public origin of the deployed site — must mirror SITE in
// tools/make-locales.mjs. hreflang links are asserted to be fully qualified
// under this origin.
const SITE = 'https://greg711002.github.io/stylus-landing';

// Relative href from one locale page to another, mirroring relHref in
// tools/make-locales.mjs: en lives at the root, every other locale one folder
// below it, so sub-folder pages climb one level with '../' first.
const relHref = (fromCode, toCode) => (fromCode === 'en' ? '' : '../') + (toCode === 'en' ? '' : `${toCode}/`);
const PAGES = LOCALES.map((loc) => ({ file: loc.file, label: loc.file, lang: loc.code, rtl: Boolean(loc.rtl) }));

async function exists(p) {
  const info = await stat(p).catch(() => null);
  return Boolean(info && info.isFile());
}

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const css = await readFile(join(ROOT, 'assets/css/styles.css'), 'utf8');
const js = await readFile(join(ROOT, 'assets/js/main.js'), 'utf8');

const refs = [];
for (const m of css.matchAll(/url\((?:'|")?([^'")]+)(?:'|")?\)/g)) {
  refs.push({ ref: m[1], from: 'assets/css/styles.css', base: join(ROOT, 'assets/css') });
}

const perPage = {};

for (const page of PAGES) {
  const html = await readFile(join(ROOT, page.file), 'utf8');
  const pageBase = dirname(join(ROOT, page.file));
  const pageRefs = [];

  for (const m of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) pageRefs.push({ ref: m[1], from: `${page.label}`, base: pageBase });
  for (const m of html.matchAll(/(?:srcset|imagesrcset)="([^"]+)"/g)) {
    for (const part of m[1].split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url) pageRefs.push({ ref: url, from: `${page.label} (srcset)`, base: pageBase });
    }
  }
  refs.push(...pageRefs);

  // <html lang> must match the page it belongs to.
  const htmlLang = (html.match(/<html lang="([^"]+)"/) || [])[1];
  if (htmlLang !== page.lang) problems.push(`LANG ${page.label}: <html lang="${htmlLang}"> should be "${page.lang}"`);

  // A right-to-left locale must say so on <html>, and no other page may.
  const hasRtl = /<html [^>]*dir="rtl"/.test(html);
  if (hasRtl !== page.rtl) problems.push(`RTL ${page.label}: dir="rtl" is ${hasRtl ? 'present' : 'missing'}`);

  // Every page must link to each of its siblings, never to itself, and mark
  // exactly one locale as the current one.
  for (const other of LOCALES.filter((l) => l.code !== page.lang)) {
    const rel = relHref(page.lang, other.code);
    if (!html.includes(`class="lang" href="${rel}"`)) {
      problems.push(`SWITCHER ${page.label}: no link to ${rel} (${other.code})`);
    }
  }
  if (new RegExp(`class="lang" href="[^"]*" hreflang="${page.lang}"`).test(html)) {
    problems.push(`SWITCHER ${page.label}: the switcher links to its own locale`);
  }
  const currentLang = (html.match(/class="lang lang--current"[^>]*lang="([^"]+)"/) || [])[1];
  if (currentLang !== page.lang) {
    problems.push(`SWITCHER ${page.label}: marks "${currentLang}" as current, expected "${page.lang}"`);
  }

  // og:locale must be set exactly once and name this page's own locale.
  const locales = [...html.matchAll(/property="og:locale"/g)].length;
  if (locales !== 1) problems.push(`OG_LOCALE ${page.label}: expected 1 og:locale, found ${locales}`);
  const ogOwn = LOCALES.find((l) => l.code === page.lang).og;
  const ogValue = (html.match(/property="og:locale" content="([^"]+)"/) || [])[1];
  if (ogValue !== ogOwn) problems.push(`OG_LOCALE ${page.label}: og:locale is "${ogValue}", expected "${ogOwn}"`);
  const alternate = [...html.matchAll(/property="og:locale:alternate"/g)].length;
  if (alternate !== LOCALES.length - 1) {
    problems.push(`OG_LOCALE ${page.label}: expected ${LOCALES.length - 1} og:locale:alternate, found ${alternate}`);
  }
  for (const hl of [...LOCALES.map((l) => l.code), 'x-default']) {
    if (!html.includes(`hreflang="${hl}"`)) problems.push(`HREFLANG ${page.label}: missing hreflang="${hl}"`);
  }
  // hreflang must be fully qualified under the published origin (Google ignores
  // relative hreflang), so assert the exact absolute URL rather than a token.
  for (const loc of LOCALES) {
    const expected = `<link rel="alternate" hreflang="${loc.code}" href="${SITE}${loc.path}">`;
    if (!html.includes(expected)) problems.push(`HREFLANG ${page.label}: expected ${expected}`);
  }
  if (!html.includes(`<link rel="alternate" hreflang="x-default" href="${SITE}/">`)) {
    problems.push(`HREFLANG ${page.label}: x-default is not ${SITE}/`);
  }

  // PWA hooks: a manifest link pointing at the root manifest (resolved below
  // by the refs pass) and the shared script that registers the worker.
  if (!/<link rel="manifest" href="(?:\.\.\/)?manifest\.webmanifest">/.test(html)) {
    problems.push(`PWA ${page.label}: no <link rel="manifest">`);
  }
  if (!/src="(?:\.\.\/)?assets\/js\/main\.js"/.test(html)) {
    problems.push(`PWA ${page.label}: main.js is not linked`);
  }
  if (!/<meta name="theme-color" content="#f4f8fb">/.test(html)) {
    problems.push(`PWA ${page.label}: theme-color does not match the manifest`);
  }

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const brokenAnchors = anchors.filter((a) => a && !ids.includes(a));
  const spriteUses = [...html.matchAll(/href="#(i-[a-z-]+)"/g)].map((m) => m[1]);
  const spriteDefs = [...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
  const missingSymbols = spriteUses.filter((s) => !spriteDefs.includes(s));

  perPage[page.label] = { bytes: Buffer.byteLength(html, 'utf8'), duplicateIds: dupIds, brokenAnchors, missingSymbols, spriteDefs, lang: htmlLang };
}

for (const { ref, from, base } of refs) {
  if (/^(https?:|mailto:|tel:|data:|#|\/)/.test(ref)) continue;
  let target = resolve(base, ref.split('?')[0].split('#')[0]);
  // A relative directory link (the language switcher's "pl/", "ru/") is served
  // as that folder's index.html both by serve.mjs and by GitHub Pages.
  const info = await stat(target).catch(() => null);
  if (info && info.isDirectory()) target = join(target, 'index.html');
  if (checked.has(target)) continue;
  checked.add(target);
  if (!(await exists(target))) problems.push(`MISSING ${relative(ROOT, target)}  (referenced from ${from})`);
}

// --- PWA -------------------------------------------------------------------
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));

for (const field of ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color', 'lang']) {
  if (!manifest[field]) problems.push(`MANIFEST: missing "${field}"`);
}
if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
  problems.push(`MANIFEST: display "${manifest.display}" is not installable`);
}
for (const field of ['background_color', 'theme_color']) {
  if (manifest[field] && !/^#[0-9a-f]{6}$/i.test(manifest[field])) problems.push(`MANIFEST: ${field} "${manifest[field]}" is not a #rrggbb colour`);
}
if (!/^\.?\//.test(manifest.start_url) && !manifest.start_url.startsWith('.')) {
  problems.push(`MANIFEST: start_url "${manifest.start_url}" is not relative to the manifest`);
}

const iconNames = new Set();
const declaredIconSizes = new Set();
const icons = [];
for (const icon of manifest.icons || []) {
  const file = join(ROOT, icon.src);
  iconNames.add(icon.src.split('/').pop());
  if (!(await exists(file))) {
    problems.push(`MANIFEST icon missing: ${icon.src}`);
    continue;
  }
  const buf = await readFile(file);
  const size = pngSize(buf);
  const [dw, dh] = (icon.sizes || '').split('x').map(Number);
  if (!size) problems.push(`MANIFEST icon ${icon.src} is not a PNG`);
  else if (size.w !== dw || size.h !== dh) problems.push(`MANIFEST icon ${icon.src}: declared ${icon.sizes} but the file is ${size.w}x${size.h}`);
  const purpose = icon.purpose || 'any';
  declaredIconSizes.add(`${purpose}:${icon.sizes}`);
  icons.push({ src: icon.src, sizes: icon.sizes, purpose, bytes: buf.length });
}
for (const required of ['any:192x192', 'any:512x512', 'maskable:192x192', 'maskable:512x512']) {
  if (!declaredIconSizes.has(required)) problems.push(`MANIFEST: no icon declared as ${required}`);
}

const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
const precacheBlock = (sw.match(/var PRECACHE = \[([\s\S]*?)\];/) || [])[1];
if (!precacheBlock) problems.push('SW: PRECACHE list not found');
const precache = [...(precacheBlock || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
for (const url of precache) {
  const rel = url.replace(/^\.\//, '');
  if (!rel || rel.endsWith('/')) continue; // './' and './pl/' stand for directories
  if (!(await exists(join(ROOT, rel)))) problems.push(`SW precache points at a missing file: ${url}`);
}
for (const page of [...LOCALES.map((l) => l.file), 'offline.html', 'manifest.webmanifest', 'assets/css/styles.css', 'assets/js/main.js']) {
  if (!precache.includes(`./${page}`)) problems.push(`SW: ${page} is not precached`);
}
for (const marker of ['skipWaiting', 'clients.claim', 'caches.delete', "request.mode === 'navigate'", 'ignoreSearch']) {
  if (!sw.includes(marker)) problems.push(`SW: expected "${marker}" in sw.js`);
}
if (!/var CACHE_PREFIX = '([^']+)'/.test(sw)) problems.push('SW: cache prefix not found');
if (!js.includes('serviceWorker') || !js.includes("'sw.js'")) problems.push('JS: main.js does not register sw.js');

// The offline page is served for ANY failed navigation, including /pl/, so it
// has to render without a single extra request.
const offline = await readFile(join(ROOT, 'offline.html'), 'utf8');
const offlineRefs = [...offline.matchAll(/\s(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(#|data:|https?:)/.test(u));
if (offlineRefs.length) problems.push(`OFFLINE: offline.html must be self-contained, it references ${offlineRefs.join(', ')}`);
if (!/<main class="card">/.test(offline)) problems.push('OFFLINE: offline.html lost its <main class="card"> landmark');
// One translated line per locale, or a reader is served an English fallback only.
const offlineLangs = [...offline.matchAll(/<p lang="([^"]+)"/g)].map((m) => m[1]);
for (const loc of LOCALES) {
  if (loc.code !== 'en' && !offlineLangs.includes(loc.code)) {
    problems.push(`OFFLINE: no offline message for locale "${loc.code}"`);
  }
}

// Every file in assets/img should be used at least once (catch dead weight).
// Manifest icons count as used: they are referenced by manifest.webmanifest.
const usedNames = new Set([
  ...refs.map((r) => r.ref.split('/').pop().split('?')[0]),
  ...iconNames,
]);
const imgDir = join(ROOT, 'assets/img');
const unused = (await readdir(imgDir)).filter((name) => !usedNames.has(name));

// --- locales ---------------------------------------------------------------
// Each dictionary must carry exactly the English key set, and no localized page
// may still contain an English string that its dictionary translates.
const dicts = {};
for (const loc of LOCALES) {
  dicts[loc.code] = JSON.parse(await readFile(join(ROOT, 'locales', `${loc.code}.json`), 'utf8'));
}
const enKeys = Object.keys(dicts.en);
const localeKeys = {};
for (const loc of LOCALES) {
  const keys = Object.keys(dicts[loc.code]);
  const keyDiff = [
    ...enKeys.filter((k) => !keys.includes(k)).map((k) => `missing in ${loc.code}.json: ${k}`),
    ...keys.filter((k) => !enKeys.includes(k)).map((k) => `extra in ${loc.code}.json: ${k}`),
  ];
  if (keyDiff.length) problems.push(...keyDiff.map((k) => `LOCALES ${k}`));
  localeKeys[loc.code] = {
    keys: keys.length,
    // Strings a language legitimately shares with English (e.g. "Menu" in
    // Polish). Meaningless for English itself, so it stays empty there.
    identicalByDesign: loc.code === 'en'
      ? []
      : enKeys.filter((k) => k in dicts[loc.code] && dicts.en[k] === dicts[loc.code][k]),
  };
}

const untranslated = [];
for (const loc of LOCALES) {
  if (loc.code === 'en') continue;
  const html = await readFile(join(ROOT, loc.file), 'utf8');
  const dict = dicts[loc.code];
  for (const key of enKeys) {
    if (!(key in dict) || dicts.en[key] === dict[key]) continue;
    // Whole text node or whole attribute value; a partial match would risk
    // flagging legitimate leftovers such as href="#reviews".
    const raw = dicts.en[key];
    const needles = [`>${raw}<`, `"${raw}"`, `>${raw}\n`];
    if (needles.some((n) => html.includes(n))) untranslated.push(`${loc.file}: ${key}`);
  }
}
if (untranslated.length) problems.push(...untranslated.map((k) => `UNTRANSLATED ${k}`));

// A language folder that no page or script knows about is a stale build: it
// would still be served, but nothing keeps it in sync.
const staleFolders = [];
for (const entry of await readdir(ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^[a-z]{2}(-[a-z]{2})?$/.test(entry.name)) continue;
  if (!LOCALES.some((l) => l.code === entry.name)) staleFolders.push(entry.name + '/');
}
if (staleFolders.length) problems.push(`LOCALES: translated folder(s) not in the LOCALES table: ${staleFolders.join(', ')}`);

console.log(JSON.stringify({
  localRefs: checked.size,
  externalCount: refs.filter((r) => /^(https?:|mailto:|tel:)/.test(r.ref)).length,
  externalUnique: [...new Set(refs.filter((r) => /^(https?:|mailto:|tel:)/.test(r.ref)).map((r) => r.ref))].sort(),
  pages: perPage,
  pwa: {
    manifestBytes: (await stat(join(ROOT, 'manifest.webmanifest'))).size,
    name: manifest.name,
    short_name: manifest.short_name,
    display: manifest.display,
    start_url: manifest.start_url,
    lang: manifest.lang,
    icons,
    precache: precache.length,
    offlineBytes: Buffer.byteLength(offline, 'utf8'),
    swBytes: Buffer.byteLength(sw, 'utf8'),
  },
  localeKeys,
  untranslated,
  missing: problems,
  unusedImages: unused.sort(),
  jsBytes: js.length,
}, null, 2));

if (problems.length) process.exitCode = 1;