'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  stripLocale,
  withLocale,
} from '@/lib/locale';
import type { Locale } from '@/lib/locale';
import { DICT } from './dict';
import type { DictKey } from './dict';

export type { Locale, DictKey };

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey | string) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

/**
 * The locale comes from the URL segment (see middleware + app/[locale]), so the
 * first server render already has the right language - no post-hydration flash.
 * Switching language navigates to the same page under the new prefix.
 */
export function I18nProvider({
  children,
  locale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  locale?: Locale;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
      const { search, hash } = window.location;
      router.replace(`${withLocale(next, stripLocale(pathname ?? '/'))}${search}${hash}`);
    },
    [pathname, router],
  );

  const t = useCallback(
    (key: string) => {
      const entry = DICT[key as DictKey];
      if (!entry) return key;
      return entry[locale] ?? entry.en ?? key;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}

/** Translate an enum value coming from the API, falling back to the raw value. */
export function useEnumLabel() {
  const { t } = useI18n();
  return useCallback(
    (group: string, value?: string | null) => {
      if (!value) return '';
      const key = `enum.${group}.${value}`;
      const translated = t(key);
      return translated === key ? value.replace(/_/g, ' ') : translated;
    },
    [t],
  );
}
