/** Catalog icons are administered and stored with their database entries. */

/** True when DB icon looks corrupted (????) or empty. */
export function isBrokenIcon(icon?: string | null): boolean {
  if (!icon) return true;
  const trimmed = icon.trim();
  if (!trimmed) return true;
  // All ASCII '?' / replacement chars — typical mojibake after bad encoding
  if (/^[?\uFFFD\u0000-\u001F]+$/u.test(trimmed)) return true;
  // Mostly question marks with junk (e.g. "?? ??" / "??\uFFFD")
  const qRatio = (trimmed.match(/[?\uFFFD]/g) || []).length / trimmed.length;
  if (qRatio >= 0.5 && /[?\uFFFD]/.test(trimmed)) return true;
  return false;
}

/** Resolved icon or empty string — never returns a broken stored value. */
export function resolveCategoryIcon(slug?: string | null, stored?: string | null): string {
  if (!isBrokenIcon(stored)) return stored!.trim();
  return '';
}

/** Resolved icon or empty string — never returns a broken stored value. */
export function resolveBenefitIcon(slug?: string | null, stored?: string | null): string {
  if (!isBrokenIcon(stored)) return stored!.trim();
  return '';
}

export function resolveIcon(
  kind: 'category' | 'benefit',
  slug?: string | null,
  stored?: string | null,
): string {
  return kind === 'category'
    ? resolveCategoryIcon(slug, stored)
    : resolveBenefitIcon(slug, stored);
}
