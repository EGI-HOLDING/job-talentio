/**
 * Locale primitives shared by middleware (edge), server components, and client
 * code. Keep this file free of React and Next imports so every runtime can use it.
 */
export const LOCALES = ['uz', 'ru', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'uz';

/** Read by middleware to keep unprefixed entry points on the last used language. */
export const LOCALE_COOKIE = 'jt_locale';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Locale segment of a pathname, or null when the path is not prefixed yet. */
export function localeFromPathname(pathname: string): Locale | null {
  const segment = pathname.split('/')[1];
  return isLocale(segment) ? segment : null;
}

/** '/ru/jobs?x=1' -> '/jobs?x=1'; unprefixed paths are returned unchanged. */
export function stripLocale(pathname: string): string {
  const locale = localeFromPathname(pathname);
  if (!locale) return pathname || '/';
  const rest = pathname.slice(locale.length + 1);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

function isExternalHref(href: string): boolean {
  return (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('//') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('#')
  );
}

/** Prefix an app-internal path with the locale segment. External hrefs pass through. */
export function withLocale(locale: Locale, href: string): string {
  if (!href || isExternalHref(href)) return href;
  if (!href.startsWith('/')) return href;
  const withoutLocale = stripLocale(href);
  return withoutLocale === '/' ? `/${locale}` : `/${locale}${withoutLocale}`;
}

/** Cookie wins over Accept-Language so an explicit switch is never overridden. */
export function pickLocale(
  cookieValue?: string | null,
  acceptLanguage?: string | null,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
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
    // Uzbekistan browsers commonly report Cyrillic Uzbek or regional Russian.
    if (base === 'uz') return 'uz';
  }
  return DEFAULT_LOCALE;
}
