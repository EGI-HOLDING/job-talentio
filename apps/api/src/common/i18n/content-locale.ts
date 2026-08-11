import { createHash } from 'node:crypto';
import { DEFAULT_LOCALE, isLocale } from './locale';
import type { Locale } from './locale';

export type ContentTranslation<T> = T & {
  locale: string;
  isMachine: boolean;
};

export type ResolvedContent<T> = {
  content: T;
  /** Language actually served, which may differ from the one requested. */
  contentLocale: Locale;
  isMachineTranslated: boolean;
  /** True when nothing matched the request and the original was served. */
  isFallback: boolean;
  /** Locales a reader can switch to, used for hreflang and language chips. */
  availableLocales: Locale[];
};

/**
 * Picks the best version of author-written content:
 * requested language -> original language -> English -> anything available.
 * Human translations always win over machine output for the same language.
 */
export function resolveContent<T>(
  original: T,
  originalLocale: string,
  translations: Array<ContentTranslation<T>>,
  requested: Locale,
): ResolvedContent<T> {
  const source = isLocale(originalLocale) ? originalLocale : DEFAULT_LOCALE;
  const available = new Set<Locale>([source]);
  for (const t of translations) {
    if (isLocale(t.locale)) available.add(t.locale);
  }

  const pick = (locale: Locale): ContentTranslation<T> | null => {
    const matches = translations.filter((t) => t.locale === locale);
    if (!matches.length) return null;
    return matches.find((t) => !t.isMachine) ?? matches[0];
  };

  const result = (
    content: T,
    contentLocale: Locale,
    isMachineTranslated: boolean,
  ): ResolvedContent<T> => ({
    content,
    contentLocale,
    isMachineTranslated,
    isFallback: contentLocale !== requested,
    availableLocales: [...available],
  });

  if (requested === source) return result(original, source, false);

  const exact = pick(requested);
  if (exact) return result(stripMeta(exact), requested, exact.isMachine);

  return result(original, source, false);
}

function stripMeta<T>(translation: ContentTranslation<T>): T {
  const { locale: _locale, isMachine: _isMachine, ...rest } = translation;
  return rest as unknown as T;
}

/** Stable fingerprint of the source text, so stale machine output is detectable. */
export function contentHash(...parts: Array<string | null | undefined>): string {
  return createHash('sha256').update(parts.filter(Boolean).join('\u0000')).digest('hex');
}
