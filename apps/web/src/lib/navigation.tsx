'use client';

import NextLink from 'next/link';
import {
  useParams,
  usePathname as useNextPathname,
  useRouter as useNextRouter,
} from 'next/navigation';
import { forwardRef, useCallback, useMemo } from 'react';
import type { ComponentProps } from 'react';
import { DEFAULT_LOCALE, isLocale, localeFromPathname, stripLocale, withLocale } from '@/lib/locale';
import type { Locale } from '@/lib/locale';

/**
 * Locale-aware navigation wrappers. Import `Link` / `useRouter` / `usePathname`
 * from here instead of `next/navigation` so every internal href carries the
 * active locale segment and no request bounces through the middleware redirect.
 */

export function useCurrentLocale(): Locale {
  const params = useParams();
  const pathname = useNextPathname();
  const fromParams = params?.locale;
  if (isLocale(fromParams)) return fromParams;
  return localeFromPathname(pathname ?? '/') ?? DEFAULT_LOCALE;
}

type LinkProps = ComponentProps<typeof NextLink>;

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, ...rest },
  ref,
) {
  const locale = useCurrentLocale();
  const localizedHref = typeof href === 'string' ? withLocale(locale, href) : href;
  return <NextLink ref={ref} href={localizedHref} {...rest} />;
});

/** Same shape as next/navigation's router, but push/replace/prefetch add the locale. */
export function useRouter() {
  const router = useNextRouter();
  const locale = useCurrentLocale();

  const push = useCallback(
    (href: string, options?: Parameters<typeof router.push>[1]) =>
      router.push(withLocale(locale, href), options),
    [router, locale],
  );
  const replace = useCallback(
    (href: string, options?: Parameters<typeof router.replace>[1]) =>
      router.replace(withLocale(locale, href), options),
    [router, locale],
  );
  const prefetch = useCallback(
    (href: string) => router.prefetch(withLocale(locale, href)),
    [router, locale],
  );

  return useMemo(
    () => ({
      ...router,
      push,
      replace,
      prefetch,
      back: router.back,
      forward: router.forward,
      refresh: router.refresh,
    }),
    [router, push, replace, prefetch],
  );
}

/** Pathname without the locale segment, so URL sync logic stays locale agnostic. */
export function usePathname(): string {
  const pathname = useNextPathname();
  return stripLocale(pathname ?? '/');
}

/**
 * Localizes a path for full-page navigations (`window.location.href`) that
 * bypass the router, e.g. auth redirects. The active locale is read from the
 * current URL, which middleware guarantees is always prefixed. External URLs
 * pass through unchanged.
 */
export function localeHref(href: string): string {
  const locale =
    typeof window === 'undefined'
      ? DEFAULT_LOCALE
      : (localeFromPathname(window.location.pathname) ?? DEFAULT_LOCALE);
  return withLocale(locale, href);
}

export function localeUrl(locale: Locale, href: string): string {
  return withLocale(locale, href);
}
