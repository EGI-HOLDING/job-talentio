import {
  assertCatalogLabel,
  assertLookupName,
  catalogLabelIssue,
  isGibberishCatalogKey,
  normalizeLookupKey,
} from '@job-talentio/shared';
import { slugify } from './utils';

export {
  assertCatalogLabel,
  assertLookupName,
  catalogLabelIssue,
  isGibberishCatalogKey,
  normalizeLookupKey,
};

export function catalogSlugify(input: string): string {
  return slugify(input.trim()) || normalizeLookupKey(input).slice(0, 60);
}

export function titleCaseWords(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
