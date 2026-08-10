import { DEFAULT_LOCALE, isLocale, localeFromAcceptLanguage } from './locale';
import type { Locale } from './locale';

type LocaleRequest = {
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  user?: { locale?: string };
};

/**
 * Same resolution order as the response interceptor, exposed for handlers that
 * need the language before building their query:
 * `?locale=` -> `X-Locale` -> `Accept-Language` -> user preference -> default.
 */
export function requestLocale(request: LocaleRequest): Locale {
  const fromQuery = request.query?.locale;
  if (isLocale(fromQuery)) return fromQuery;

  const fromHeader = request.headers?.['x-locale'];
  if (isLocale(fromHeader)) return fromHeader;

  const fromAccept = localeFromAcceptLanguage(request.headers?.['accept-language'] as string);
  if (fromAccept) return fromAccept;

  const fromUser = request.user?.locale;
  if (isLocale(fromUser)) return fromUser;

  return DEFAULT_LOCALE;
}
