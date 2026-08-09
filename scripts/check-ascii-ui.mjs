/**
 * Fail CI if UI source reintroduces punctuation that commonly mojibakes
 * (em/en dash, ellipsis, middle dot) or already-corrupted sequences.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['apps/web/src', 'apps/admin/src'];
const EXTS = new Set(['.ts', '.tsx', '.css', '.js', '.jsx']);

// Detect risky code points and common mojibake glyphs (via escapes).
// Flag literal risky glyphs. Allow `\uXXXX` escapes in source (sanitizer helpers).
const FORBIDDEN_CODEPOINTS = /[\u2013\u2014\u2026\u00B7\u2022\u00E2\u20AC\u00C2\u00C3]/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(name))) out.push(p);
  }
  return out;
}

const hits = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (FORBIDDEN_CODEPOINTS.test(line)) {
        hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
      }
    });
  }
}

if (hits.length) {
  console.error('Forbidden punctuation / mojibake found in UI source:');
  for (const h of hits.slice(0, 50)) console.error(`  ${h}`);
  if (hits.length > 50) console.error(`  ... and ${hits.length - 50} more`);
  process.exit(1);
}

console.log('ASCII UI check passed.');
