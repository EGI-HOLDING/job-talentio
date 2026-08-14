import { isBlockedCatalogKey } from './catalog-blocklist';
import { isCatalogTechIdentity } from './i18n/catalog-tech-identity';
import { slugify } from './utils';

/** Shared key for catalog matching (skills/benefits/languages/cities). */
export function normalizeLookupKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яёўғқҳ]+/gi, '')
    .slice(0, 80);
}

export function catalogSlugify(input: string): string {
  return slugify(input.trim()) || normalizeLookupKey(input).slice(0, 60);
}

export function titleCaseWords(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}+.#/&\s-]{0,78}$/u;
const NEUTRAL_REJECT = 'Name is not allowed';

export function assertLookupName(name: string) {
  if (!NAME_RE.test(name.trim())) {
    throw new Error(
      'Name contains invalid characters. Use letters, numbers, and + . # / & -',
    );
  }
}

/** Single-letter languages / punctuation that collapse after normalizeLookupKey. */
const SHORT_TECH_RAW = /^(?:[crdfjkq]|c\+\+|c#|f#|r)$/i;

/** Heuristic spam / keyboard-smash labels (normalized key). */
export function isGibberishCatalogKey(normalizedKey: string, rawName: string): boolean {
  const key = (normalizedKey || '').trim().toLowerCase();
  const trimmed = (rawName || '').trim();
  if (/^\d+$/.test(key)) return true;
  // C++, HTML5, HTTPS, and other product names are not keyboard smash.
  if (trimmed && isCatalogTechIdentity(trimmed)) return false;
  if (key.length < 2) {
    return !SHORT_TECH_RAW.test(trimmed);
  }
  if (/(.)\1{3,}/.test(key)) return true;
  if (/^(asdf|asdfgh|qwer|qwerty|zxcv|zxcvbn|hjkl|aaa+|bbb+|xxx+)+\d*$/.test(key)) {
    return true;
  }
  // Long strings with no vowels (Latin + Cyrillic) are usually garbage.
  // Skip versioned / all-caps acronyms (html5, MSSQL) that lost their vowels.
  if (key.length >= 5 && !/[aeiouyаеёиоуыэюяў]/i.test(key)) {
    if (/\d/.test(key)) return false;
    if (/^[A-Z0-9][A-Z0-9+.#/\s-]{1,14}$/.test(trimmed)) return false;
    return true;
  }
  const letters = (trimmed.match(/\p{L}/gu) || []).length;
  if (trimmed.length >= 4 && letters < 2) return true;
  return false;
}

/**
 * Content gate before creating catalog / M2M labels.
 * Charset via assertLookupName unless skipCharset (job titles allow extra chars).
 */
export function assertCatalogLabel(name: string, opts?: { skipCharset?: boolean }) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error(NEUTRAL_REJECT);
  if (!opts?.skipCharset) assertLookupName(trimmed);
  const key = normalizeLookupKey(trimmed);
  if (isBlockedCatalogKey(key) || isGibberishCatalogKey(key, trimmed)) {
    throw new Error(NEUTRAL_REJECT);
  }
}
