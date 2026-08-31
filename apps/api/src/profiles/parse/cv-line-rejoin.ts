/**
 * Rejoin PDF/DOCX hard-wraps so a sentence split across lines stays one line.
 * Continuation lines do not need a bullet; role titles and dates stay separate.
 */

const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|' +
  'январ[ьяе]?|феврал[ьяе]?|март[ае]?|апрел[ьяе]?|ма[йяе]|июн[ьяе]?|июл[ьяе]?|август[ае]?|сентябр[ьяе]?|октябр[ьяе]?|ноябр[ьяе]?|декабр[ьяе]?|' +
  'yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr';

const CURRENT_END =
  'present|now|current|hozir|настоящее\\s*время|по\\s*н\\.?\\s*в\\.?|н\\.?\\s*в\\.?';

const DATE_RANGE_RE = new RegExp(
  `(?:(?:${MONTHS})\\s+)?(?:20\\d{2}|19\\d{2})\\s*[-–—to]+\\s*(?:(?:${MONTHS})\\s+)?(?:20\\d{2}|19\\d{2}|${CURRENT_END})`,
  'iu',
);

const BULLET_RE =
  /^(?:[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25A0\u25AA\uF0B7•●▪◦‣∙]|[-*–—])\s+\S/;

const SECTION_HEADER_RE = new RegExp(
  '^(?:' +
    'work\\s+experience|professional\\s+experience|experience|employment|work\\s+history|' +
    'education|academic(?:\\s+background)?|skills|technical\\s+skills|languages|' +
    'summary|profile|objective|about(?:\\s+me)?|certificates?|certifications?|projects?|' +
    'опыт(?:\\s*работы)?|образование|навыки|языки|о\\s+себе|обо\\s+мне|' +
    "ish\\s+tajribasi|ta'?lim|ko'?nikmalar|tillar|men\\s+haqimda" +
    ')\\s*:?$',
  'iu',
);

export function isCvBulletLine(line: string): boolean {
  return BULLET_RE.test(line.trim());
}

export function isCvDateLine(line: string): boolean {
  return DATE_RANGE_RE.test(line.trim());
}

export function isCvSectionHeader(line: string): boolean {
  return SECTION_HEADER_RE.test(line.trim());
}

/** Short heading: job title, company, ALL CAPS label. Not a sentence. */
export function isCvTitleLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (isCvBulletLine(t) || isCvDateLine(t) || isCvSectionHeader(t)) return false;
  if (/[.?!]$/.test(t)) return false;
  if (/@/.test(t)) return false;
  if (!/^\p{Lu}/u.test(t)) return false;

  const words = t.split(/\s+/).filter((w) => !/^[&/|,]$/.test(w));
  if (words.length === 0 || words.length > 10) return false;

  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 2 && letters === letters.toUpperCase()) return true;

  const contentWords = words.filter((w) => /\p{L}{2,}/u.test(w));
  if (contentWords.length === 0) return false;
  const capped = contentWords.filter((w) => /^\p{Lu}/u.test(w));
  return capped.length / contentWords.length >= 0.7;
}

/** Date, section, or title/company heading — start of a new role or block. */
export function isCvRoleBoundary(line: string): boolean {
  return isCvDateLine(line) || isCvSectionHeader(line) || isCvTitleLikeHeading(line);
}

function isIncompleteLine(line: string): boolean {
  return !/[.?!]$/.test(line.trim());
}

function isLowercaseStart(line: string): boolean {
  return /^\p{Ll}/u.test(line.trim());
}

/** Leftover wrap like "systems." — short, not a heading. */
function isShortFragment(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 40) return false;
  if (isCvBulletLine(t) || isCvRoleBoundary(t)) return false;
  return isLowercaseStart(t) || /^\p{Ll}/u.test(t.replace(/^[^\p{L}]+/u, ''));
}

function shouldJoin(prev: string, current: string): boolean {
  if (!prev || isCvBulletLine(current) || isCvRoleBoundary(current)) return false;
  if (isCvRoleBoundary(prev) && !isCvBulletLine(prev)) return false;
  if (isIncompleteLine(prev) || isLowercaseStart(current) || isShortFragment(current)) {
    return true;
  }
  return false;
}

function joinLines(prev: string, current: string): string {
  if (/\p{L}-$/u.test(prev) && /^\p{L}/u.test(current)) {
    return prev.slice(0, -1) + current;
  }
  return `${prev} ${current}`;
}

export function rejoinWrappedCvLines(text: string): string {
  const rawLines = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
  const out: string[] = [];

  for (const raw of rawLines) {
    const line = raw.replace(/[ \t]+/g, ' ').trim();
    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    const prev = out.length ? out[out.length - 1] : '';
    if (prev && shouldJoin(prev, line)) {
      out[out.length - 1] = joinLines(prev, line);
    } else {
      out.push(line);
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
