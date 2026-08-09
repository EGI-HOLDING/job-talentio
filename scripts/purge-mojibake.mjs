/**
 * Purge mojibake + risky Unicode punctuation from UI source.
 * Prefer ASCII separators so wrong charset never shows mojibake again.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = [
  path.join(process.cwd(), 'apps/web/src'),
  path.join(process.cwd(), 'apps/admin/src'),
];
const EXTS = new Set(['.ts', '.tsx', '.css']);
const SKIP = new Set([path.join(process.cwd(), 'apps/web/src/lib/text.ts')]);

const REPLACEMENTS = [
  [/\u00E2\u20AC\u201D/g, '-'],
  [/\u00E2\u20AC\u201C/g, '-'],
  [/\u00E2\u20AC\u02DC/g, "'"],
  [/\u00E2\u20AC\u2122/g, "'"],
  [/\u00E2\u20AC\u0153/g, '"'],
  [/\u00E2\u20AC\u009D/g, '"'],
  [/\u00E2\u20AC\u00A6/g, '...'],
  [/\u00C3\u00D7/g, 'x'],
  [/\u00C2\u00B7/g, ' | '],
  [/\u00C2 /g, ' '],
  [/\u2014/g, '-'],
  [/\u2013/g, '-'],
  [/\u2212/g, '-'],
  [/\u2026/g, '...'],
  [/\u00B7/g, ' | '],
  [/\u2022/g, ' | '],
  [/\u00D7/g, 'x'],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(name))) out.push(p);
  }
  return out;
}

let filesChanged = 0;
let totalReplacements = 0;

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (SKIP.has(file)) continue;
    let buf = fs.readFileSync(file);
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      buf = buf.subarray(3);
    }
    let text = buf.toString('utf8');
    const before = text;
    let count = 0;
    for (const [re, to] of REPLACEMENTS) {
      text = text.replace(re, () => {
        count += 1;
        return to;
      });
    }
    text = text.replace(/ \|  \| /g, ' | ');
    if (text !== before) {
      fs.writeFileSync(file, text, { encoding: 'utf8' });
      filesChanged += 1;
      totalReplacements += count;
      console.log(`${path.relative(process.cwd(), file)} (+${count})`);
    }
  }
}

console.log(`Done. files=${filesChanged} replacements=${totalReplacements}`);
