/**
 * UTF-8-safe icon catalog (Unicode escapes — survives non-UTF8 editors/shells).
 * Stored DB emojis can get corrupted to "????" on some seed paths; resolve via slug.
 */

export const CATEGORY_ICONS: Record<string, string> = {
  'it-software': '\u{1F4BB}', // 💻
  finance: '\u{1F3E6}', // 🏦
  'sales-marketing': '\u{1F4C8}', // 📈
  design: '\u{1F3A8}', // 🎨
  hr: '\u{1F465}', // 👥
  education: '\u{1F4DA}', // 📚
  healthcare: '\u{1F3E5}', // 🏥
  engineering: '\u{2699}\u{FE0F}', // ⚙️
  'customer-support': '\u{1F3A7}', // 🎧
  logistics: '\u{1F69A}', // 🚚
  legal: '\u{2696}\u{FE0F}', // ⚖️
  hospitality: '\u{1F3E8}', // 🏨
};

export const BENEFIT_ICONS: Record<string, string> = {
  'health-insurance': '\u{1F3E5}', // 🏥
  'remote-work': '\u{1F3E0}', // 🏠
  'flexible-hours': '\u{23F0}', // ⏰
  'meal-allowance': '\u{1F371}', // 🍱
  'learning-budget': '\u{1F4D6}', // 📖
  gym: '\u{1F4AA}', // 💪
  'paid-vacation': '\u{1F334}', // 🌴
  'stock-options': '\u{1F4CA}', // 📊
  relocation: '\u{2708}\u{FE0F}', // ✈️
  equipment: '\u{1F4BB}', // 💻
  'parental-leave': '\u{1F476}', // 👶
  bonus: '\u{1F4B0}', // 💰
};

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
  if (slug && CATEGORY_ICONS[slug]) return CATEGORY_ICONS[slug];
  return '';
}

/** Resolved icon or empty string — never returns a broken stored value. */
export function resolveBenefitIcon(slug?: string | null, stored?: string | null): string {
  if (!isBrokenIcon(stored)) return stored!.trim();
  if (slug && BENEFIT_ICONS[slug]) return BENEFIT_ICONS[slug];
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
