// Builds the localized pages from index.html + locales/*.json.
//
// Locale layout:  en -> /  (index.html),  every other code -> /<code>/index.html.
// The LOCALES table below is the single source of truth for the whole build: it
// drives the output folders, the hreflang set, the og:locale alternates and the
// order of the language switcher on every page.
//
// Why a generator and not a runtime i18n loader: every page must be a real,
// crawlable document with its own <html lang>, <title> and og:* tags. A runtime
// string-swapper would be invisible to crawlers and to link previews.
//
// Why plain Node and not a headless browser: the site must stay dependency-free.
// The HTML is handled by a small tokenizer that only touches text segments and
// whole attribute values, so markup, indentation and comments are preserved
// byte-for-byte everywhere the translation does not apply.
//
// index.html is itself an output: its language chrome (og:locale, hreflang, the
// switcher) is regenerated from the same table as the other pages, so the three
// documents cannot drift apart. Hand edits to the English copy are safe - they
// live in the body, which the EN pass leaves untouched.
//
// Usage: node tools/make-locales.mjs [--dry]
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'index.html');
const DRY = process.argv.includes('--dry');

// One row per locale. `dir` is the output folder ('' = site root), `path` is the
// public URL used in hreflang and in the switcher, `og` is og:locale.
const LOCALES = [
  { code: 'en', dir: '', path: '/', label: 'English', short: 'EN', og: 'en_US' },
  { code: 'pl', dir: 'pl', path: '/pl/', label: 'Polski', short: 'PL', og: 'pl_PL' },
  { code: 'ru', dir: 'ru', path: '/ru/', label: 'Русский', short: 'RU', og: 'ru_RU' },
  { code: 'zh', dir: 'zh', path: '/zh/', label: '中文（简体）', short: 'ZH', og: 'zh_CN' },
  { code: 'es', dir: 'es', path: '/es/', label: 'Español', short: 'ES', og: 'es_ES' },
  { code: 'hi', dir: 'hi', path: '/hi/', label: 'हिन्दी', short: 'HI', og: 'hi_IN' },
  { code: 'pt', dir: 'pt', path: '/pt/', label: 'Português (BR)', short: 'PT', og: 'pt_BR' },
  { code: 'bn', dir: 'bn', path: '/bn/', label: 'বাংলা', short: 'BN', og: 'bn_BD' },
  { code: 'fr', dir: 'fr', path: '/fr/', label: 'Français', short: 'FR', og: 'fr_FR' },
  { code: 'de', dir: 'de', path: '/de/', label: 'Deutsch', short: 'DE', og: 'de_DE' },
  { code: 'ja', dir: 'ja', path: '/ja/', label: '日本語', short: 'JA', og: 'ja_JP' },
  { code: 'ar', dir: 'ar', path: '/ar/', label: 'العربية', short: 'AR', og: 'ar_AR', rtl: true },
  { code: 'ko', dir: 'ko', path: '/ko/', label: '한국어', short: 'KO', og: 'ko_KR' },
  { code: 'it', dir: 'it', path: '/it/', label: 'Italiano', short: 'IT', og: 'it_IT' },
  { code: 'tr', dir: 'tr', path: '/tr/', label: 'Türkçe', short: 'TR', og: 'tr_TR' },
  { code: 'id', dir: 'id', path: '/id/', label: 'Bahasa Indonesia', short: 'ID', og: 'id_ID' },
];

// Keys handled outside the body pass, with the reason.
const HEAD = ['meta_title', 'meta_description', 'og_title', 'og_description'];
const NOT_IN_MARKUP = {
  lang_switch_label: 'used as the aria-label of the language switcher added below',
};

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Split HTML into alternating text and tag segments (quotes respected). */
function segments(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) { out.push({ tag: false, v: source.slice(i) }); break; }
    if (lt > i) out.push({ tag: false, v: source.slice(i, lt) });
    let j = lt + 1;
    let quote = null;
    while (j < source.length) {
      const c = source[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') { j += 1; break; }
      j += 1;
    }
    out.push({ tag: true, v: source.slice(lt, j) });
    i = j;
  }
  return out;
}

const count = (haystack, needle) => (needle ? haystack.split(needle).length - 1 : 0);

const en = JSON.parse(readFileSync(join(ROOT, 'locales', 'en.json'), 'utf8'));
const dicts = {};
for (const loc of LOCALES) {
  const file = join(ROOT, 'locales', loc.code + '.json');
  dicts[loc.code] = JSON.parse(readFileSync(file, 'utf8'));
  const extra = Object.keys(dicts[loc.code]).filter((k) => !(k in en));
  const gone = Object.keys(en).filter((k) => !(k in dicts[loc.code]));
  if (extra.length) throw new Error(`${loc.code}.json has keys absent from en.json: ${extra.join(', ')}`);
  if (gone.length) throw new Error(`${loc.code}.json is missing keys: ${gone.join(', ')}`);
}

const baseHtml = readFileSync(SRC, 'utf8');
const LOGIN_ANCHOR = '          <a class="btn btn--ghost" href="https://mystylus.ai/login/">';

/** Translate the body of baseHtml from English into `loc`, returning the result. */
function translateBody(html, loc) {
  const dict = dicts[loc.code];
  const report = [];
  const missing = [];
  const segs = segments(html);
  const sameLanguage = loc.code === 'en';

  for (const key of Object.keys(en)) {
    if (HEAD.includes(key) || key in NOT_IN_MARKUP) continue;
    const from = en[key];
    const to = dict[key];
    if (sameLanguage || from === to) continue;

    let textHits = 0;
    let attrHits = 0;
    // Text content: the value appears verbatim (typographic apostrophes included).
    for (const seg of segs) {
      if (seg.tag) {
        // Whole attribute values only: ="…" or ='…'. Never partial matches, so
        // class names, ids and URLs are untouchable.
        for (const q of ['"', "'"]) {
          for (const variant of [escapeHtml(from), from]) {
            const needle = `=${q}${variant}${q}`;
            const hits = count(seg.v, needle);
            if (hits) {
              seg.v = seg.v.split(needle).join(`=${q}${escapeHtml(to)}${q}`);
              attrHits += hits;
            }
          }
        }
      } else {
        for (const variant of [from, escapeHtml(from)]) {
          const hits = count(seg.v, variant);
          if (hits) {
            seg.v = seg.v.split(variant).join(escapeHtml(to));
            textHits += hits;
          }
        }
      }
    }
    report.push({ key, textHits, attrHits });
    if (!textHits && !attrHits) missing.push(`${key}: "${from.slice(0, 60)}…" not found in index.html`);
  }
  return { html: segs.map((s) => s.v).join(''), report, missing };
}

/** Head tags, og:locale block, hreflang set and the language switcher. */
function buildChrome(html, loc) {
  const dict = dicts[loc.code];
  let out = html;

  // Root-relative asset URLs and the web app manifest become one level up for
  // pages that live in a sub-folder; both files sit at the site root.
  if (loc.dir) {
    out = segments(out)
      .map((s) => (s.tag
        ? s.v
          .replace(/(^|["'\s,])assets\//g, '$1../assets/')
          .replace(/(^|["'\s,])manifest\.webmanifest/g, '$1../manifest.webmanifest')
        : s.v))
      .join('');
  }

  const headEdits = [
    // dir is only emitted for a right-to-left locale, and the pattern tolerates
    // an existing dir so re-running the script stays idempotent.
    [/<html lang="[^"]*"(?: dir="[^"]*")?>/, `<html lang="${loc.code}"${loc.rtl ? ' dir="rtl"' : ''}>`],
    [/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(dict.meta_title)}</title>`],
    [/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(dict.meta_description)}">`],
    [/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(dict.og_title)}">`],
    [/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(dict.og_description)}">`],
  ];
  for (const [pattern, replacement] of headEdits) {
    if (!pattern.test(out)) throw new Error(`${loc.code}: head edit did not match: ${pattern}`);
    out = out.replace(pattern, replacement);
  }

  // og:locale + reciprocal hreflang. Absolute URLs are deliberately absent until
  // the production domain is known - same TODO as og:url/og:image/canonical.
  // Drop the existing lines first: keeps the script idempotent and prevents a
  // page from ending up with two og:locale values.
  out = out.replace(/^[ \t]*<meta property="og:locale(:alternate)?"[^\n]*\n/gm, '');
  out = out.replace(/^[ \t]*<link rel="alternate" hreflang="[^"]*"[^\n]*\n/gm, '');
  const localeBlock = [
    `<meta property="og:locale" content="${loc.og}">`,
    ...LOCALES.filter((o) => o.code !== loc.code).map((o) => `<meta property="og:locale:alternate" content="${o.og}">`),
    ...LOCALES.map((o) => `<link rel="alternate" hreflang="${o.code}" href="${o.path}">`),
    `<link rel="alternate" hreflang="x-default" href="/">`,
  ].join('\n');
  if (!/<meta name="twitter:card"[^>]*>/.test(out)) throw new Error('twitter:card anchor not found');
  out = out.replace(/(<meta name="twitter:card"[^>]*>)/, `$1\n${localeBlock}`);

  // Language switcher: a dropdown, because sixteen locales cannot sit in the
  // navbar as pills - 16 x ~41px would push the layout onto two or three rows.
  // The current locale is the <summary> of the <details> and so is not a link to
  // itself; every other locale is a real <a>, so each page still links to all of
  // its siblings. <ul>/<li> rather than nested <div>s: the strip regex above ends
  // at the first </div>, and an inner div would truncate the block it removes.
  out = out.replace(/^[ \t]*<div class="lang-switch"[\s\S]*?<\/div>\n/gm, '');
  out = out.replace(/^[ \t]*<a class="lang"[^\n]*<\/a>\n/gm, '');
  const label = dict.lang_switch_label;
  const items = LOCALES.filter((o) => o.code !== loc.code).map((o) => (
    `                <li><a class="lang" href="${o.path}" hreflang="${o.code}" lang="${o.code}" aria-label="${escapeHtml(label)}: ${escapeHtml(o.label)}">${o.short}</a></li>`
  ));
  const switcher = [
    `          <div class="lang-switch" role="group" aria-label="${escapeHtml(label)}">`,
    '            <details class="lang-picker">',
    `              <summary class="lang lang--current" aria-current="true" lang="${loc.code}">${loc.short}<span class="lang-picker__caret" aria-hidden="true"></span></summary>`,
    '              <ul class="lang-picker__list">',
    ...items,
    '              </ul>',
    '            </details>',
    '          </div>',
    '',
  ].join('\n');
  if (!out.includes(LOGIN_ANCHOR)) throw new Error('navbar actions anchor not found');
  out = out.replace(LOGIN_ANCHOR, switcher + LOGIN_ANCHOR);

  // Self-checks: the chrome must be complete and unambiguous on every page.
  const localeCount = count(out, '<meta property="og:locale"');
  if (localeCount !== 1) throw new Error(`${loc.code}: expected 1 og:locale, found ${localeCount}`);
  const altCount = count(out, '<meta property="og:locale:alternate"');
  if (altCount !== LOCALES.length - 1) throw new Error(`${loc.code}: expected ${LOCALES.length - 1} og:locale:alternate, found ${altCount}`);
  if (count(out, '<link rel="alternate" hreflang="') !== LOCALES.length + 1) throw new Error(`${loc.code}: hreflang set is incomplete`);
  if (count(out, 'class="lang-switch"') !== 1) throw new Error(`${loc.code}: expected exactly one switcher block`);
  if (count(out, 'class="lang lang--current"') !== 1) throw new Error(`${loc.code}: switcher must mark exactly one current locale`);
  const selfLink = `hreflang="${loc.code}"`;
  if (!out.includes(selfLink)) throw new Error(`${loc.code}: hreflang for its own locale is missing`);
  if (/class="lang" href="[^"]*"[^>]*hreflang="en"/.test(out) && loc.code === 'en') throw new Error('en: switcher links to itself');

  return out;
}

// --- run --------------------------------------------------------------------
let failures = 0;
for (const loc of LOCALES) {
  const body = translateBody(baseHtml, loc);
  if (body.missing.length) {
    failures += 1;
    console.error(`\nNOT APPLIED for ${loc.code}:`);
    for (const m of body.missing) console.error('  ' + m);
    continue;
  }
  const out = buildChrome(body.html, loc);
  const dest = loc.dir ? join(ROOT, loc.dir, 'index.html') : SRC;

  const applied = body.report.filter((r) => r.textHits || r.attrHits);
  const textTotal = applied.reduce((n, r) => n + r.textHits, 0);
  const attrTotal = applied.reduce((n, r) => n + r.attrHits, 0);
  const expected = Object.keys(en).length - HEAD.length - Object.keys(NOT_IN_MARKUP).length;
  console.log(
    `${(loc.dir ? loc.dir + '/' : '') + 'index.html'}: ${Buffer.byteLength(out, 'utf8')} bytes, `
    + `keys ${applied.length}/${expected}, text ${textTotal}, attrs ${attrTotal}`
  );

  if (DRY) continue;
  const tmp = dest + '.tmp';
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(tmp, out, 'utf8');
  renameSync(tmp, dest);
}

if (failures) process.exitCode = 1;

// Every locale in the table must have a dictionary on disk and nothing extra
// should be left behind, otherwise check.mjs and this script disagree.
const onDisk = readdirSync(join(ROOT, 'locales')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const inTable = LOCALES.map((l) => l.code).sort();
if (onDisk.join(',') !== inTable.join(',')) {
  console.error(`\nlocale files ${onDisk.join(',')} do not match the LOCALES table ${inTable.join(',')}`);
  process.exitCode = 1;
}
