import { isBlockedCatalogKey } from './catalog-blocklist';
import { isCatalogTechIdentity } from './catalog-tech-identity';

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

export const CATALOG_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}+.#/&\s-]{0,78}$/u;
const NEUTRAL_REJECT = 'Name is not allowed';

export type CatalogLabelIssue = 'empty' | 'charset' | 'blocked' | 'gibberish' | null;

/** Single-letter languages / punctuation that collapse after normalizeLookupKey. */
const SHORT_TECH_RAW = /^(?:[crdfjkq]|c\+\+|c#|f#|r)$/i;

export function assertLookupName(name: string) {
  if (!CATALOG_NAME_RE.test(name.trim())) {
    throw new Error(
      'Name contains invalid characters. Use letters, numbers, and + . # / & -',
    );
  }
}

/** Heuristic spam / keyboard-smash labels (normalized key). */
export function isGibberishCatalogKey(normalizedKey: string, rawName: string): boolean {
  const key = (normalizedKey || '').trim().toLowerCase();
  const trimmed = (rawName || '').trim();
  if (/^\d+$/.test(key)) return true;
  if (trimmed && isCatalogTechIdentity(trimmed)) return false;
  if (key.length < 2) {
    return !SHORT_TECH_RAW.test(trimmed);
  }
  if (/(.)\1{3,}/.test(key)) return true;
  if (/^(asdf|asdfgh|qwer|qwerty|zxcv|zxcvbn|hjkl|aaa+|bbb+|xxx+)+\d*$/.test(key)) {
    return true;
  }
  if (key.length >= 5 && !/[aeiouyаеёиоуыэюяў]/i.test(key)) {
    if (/\d/.test(key)) return false;
    if (/^[A-Z0-9][A-Z0-9+.#/\s-]{1,14}$/.test(trimmed)) return false;
    return true;
  }
  const letters = (trimmed.match(/\p{L}/gu) || []).length;
  if (trimmed.length >= 4 && letters < 2) return true;
  return false;
}

/** Why a catalog label cannot be created. Null means it is allowed. */
export function catalogLabelIssue(
  name: string,
  opts?: { skipCharset?: boolean },
): CatalogLabelIssue {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'empty';
  if (!opts?.skipCharset && !CATALOG_NAME_RE.test(trimmed)) return 'charset';
  const key = normalizeLookupKey(trimmed);
  if (isBlockedCatalogKey(key)) return 'blocked';
  if (isGibberishCatalogKey(key, trimmed)) return 'gibberish';
  return null;
}

export function assertCatalogLabel(name: string, opts?: { skipCharset?: boolean }) {
  const issue = catalogLabelIssue(name, opts);
  if (!issue) return;
  if (issue === 'charset') {
    throw new Error('Name contains invalid characters. Use letters, numbers, and + . # / & -');
  }
  throw new Error(NEUTRAL_REJECT);
}
