export const LOCALES = ['uz', 'ru', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'uz';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Highest-quality supported language from an Accept-Language header. */
export function localeFromAcceptLanguage(header?: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      const quality = q ? Number.parseFloat(q.split('=')[1]) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return null;
}

type LocalizedRow = {
  name: string;
  nameUz?: string | null;
  nameRu?: string | null;
};

/**
 * Display name for a catalog row. `name` holds the canonical English label and
 * is the final fallback, so rows without a translation still render.
 */
export function localizedName<T extends LocalizedRow>(row: T, locale: Locale): string {
  if (locale === 'uz') return row.nameUz || row.name;
  if (locale === 'ru') return row.nameRu || row.name;
  return row.name;
}

/**
 * Replaces `name` with its localized value and drops the locale columns, so
 * clients see one stable `name` field whatever the language.
 */
export function localizeRow<T extends LocalizedRow>(
  row: T,
  locale: Locale,
): Omit<T, 'nameUz' | 'nameRu'> {
  const { nameUz: _uz, nameRu: _ru, ...rest } = row;
  return { ...rest, name: localizedName(row, locale) } as Omit<T, 'nameUz' | 'nameRu'>;
}

export function localizeRows<T extends LocalizedRow>(
  rows: T[],
  locale: Locale,
): Array<Omit<T, 'nameUz' | 'nameRu'>> {
  return rows.map((row) => localizeRow(row, locale));
}

/** Prisma `select` fragment for the locale columns. */
export const LOCALE_NAME_SELECT = { nameUz: true, nameRu: true } as const;
