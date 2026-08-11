/**
 * Fail CI when user-facing copy is hardcoded in the web UI instead of going
 * through the i18n dictionary (`t('key')`).
 *
 * The check is deliberately heuristic: it only flags multi-word English text in
 * the places copy actually appears (JSX text nodes, a few attributes, and the
 * message setters used across the app). Single words and technical literals are
 * ignored so the signal stays high.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'apps/web/src';

/** Files whose English literals are intentional (dictionaries, non-UI helpers). */
const SKIP_PATHS = [
  path.normalize('apps/web/src/lib/i18n'),
  path.normalize('apps/web/src/lib/locale.ts'),
  path.normalize('apps/web/src/lib/navigation.tsx'),
  path.normalize('apps/web/src/lib/jobSeo.ts'),
  path.normalize('apps/web/src/lib/newsSeo.ts'),
  path.normalize('apps/web/src/lib/presence.tsx'),
  path.normalize('apps/web/src/app/sitemap.ts'),
  path.normalize('apps/web/src/app/robots.ts'),
];

/**
 * Known remaining exceptions, each with a reason. Add sparingly: the point of
 * this list is to make untranslated copy visible, not to hide it.
 */
const ALLOW = [
  // Brand and plan names read the same in uz/ru/en.
  /Job Talentio/,
  // Format examples inside inputs.
  /https?:\/\//,
  /@company\./,
  // Structured data / SEO strings are not user-visible copy.
  /application\/ld\+json/,
];

const TEXT_NODE = />\s*([A-Z][A-Za-z]+(?:[ ](?:[a-zA-Z]+|[A-Z][A-Za-z]+)){1,6})\s*</;
const ATTR = /\b(?:placeholder|aria-label|title)=(?:"|\{')([A-Z][A-Za-z]+(?:\s+[A-Za-z]+){1,6})(?:"|'\})/;
const MESSAGE_CALL =
  /\b(?:setError|setMsg|setMessage|setSuccess|flash|confirm|alert)\(\s*'([A-Z][A-Za-z]+(?:\s+[A-Za-z']+){1,10})'/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (SKIP_PATHS.some((skip) => path.normalize(p).startsWith(skip))) continue;
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function isIgnorable(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return true;
  }
  if (trimmed.startsWith('import ') || trimmed.startsWith('export type')) return true;
  // Lines that already translate something are assumed handled.
  if (/\bt\(|enumLabel\(/.test(trimmed)) return true;
  return ALLOW.some((pattern) => pattern.test(trimmed));
}

const hits = [];

for (const file of walk(ROOT)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (isIgnorable(line)) return;
    const match = line.match(TEXT_NODE) || line.match(ATTR) || line.match(MESSAGE_CALL);
    if (match) {
      hits.push(`${file}:${i + 1}: ${match[1]}`);
    }
  });
}

if (hits.length) {
  console.error(`Hardcoded UI copy found (${hits.length}). Move it into apps/web/src/lib/i18n/dict:`);
  for (const hit of hits.slice(0, 60)) console.error(`  ${hit}`);
  if (hits.length > 60) console.error(`  ... and ${hits.length - 60} more`);
  process.exit(1);
}

console.log('i18n UI check passed.');
