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

export function assertLookupName(name: string) {
  if (!NAME_RE.test(name.trim())) {
    throw new Error(
      'Name contains invalid characters. Use letters, numbers, and + . # / & -',
    );
  }
}
