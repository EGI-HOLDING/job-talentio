import type { Locale } from '../common/i18n/locale';

export type TranslateRequest = {
  /** Short texts translated together so the provider keeps them consistent. */
  texts: string[];
  targetLocale: Locale;
  sourceLocale?: Locale;
};

/**
 * Machine translation is a fallback for content nobody has translated by hand.
 * Providers are swapped through TRANSLATION_PROVIDER without touching callers,
 * exactly like the payment and CV parse providers.
 */
export interface TranslationProvider {
  /** Provider key, surfaced in logs and health output. */
  readonly name: string;

  /** False when the provider has no credentials; callers then skip translation. */
  readonly enabled: boolean;

  /** Returns one translation per input, in the same order. */
  translate(input: TranslateRequest): Promise<string[]>;
}

export const TRANSLATION_PROVIDER = Symbol('TRANSLATION_PROVIDER');
