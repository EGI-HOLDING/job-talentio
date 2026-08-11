import type { MessageLocale } from '@job-talentio/shared';
import { DEFAULT_LOCALE, isLocale } from './locale';

/**
 * Transactional email follows the language saved on the account, so a person
 * who uses the site in Russian is not emailed in Uzbek.
 */
export function emailLocale(locale?: string | null): MessageLocale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}
