import { Injectable, Logger } from '@nestjs/common';
import type { TranslationProvider, TranslateRequest } from '../translation.provider';
import type { Locale } from '../../common/i18n/locale';

const REQUEST_TIMEOUT_MS = 15_000;

/** DeepL has no Uzbek target, so those requests are rejected up front. */
const TARGET_LANGUAGE: Partial<Record<Locale, string>> = {
  ru: 'RU',
  en: 'EN-US',
};

const SOURCE_LANGUAGE: Partial<Record<Locale, string>> = {
  ru: 'RU',
  en: 'EN',
};

@Injectable()
export class DeeplTranslationProvider implements TranslationProvider {
  readonly name = 'deepl';
  private readonly logger = new Logger(DeeplTranslationProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly host = 'https://api-free.deepl.com',
  ) {}

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async translate({ texts, targetLocale, sourceLocale }: TranslateRequest): Promise<string[]> {
    const target = TARGET_LANGUAGE[targetLocale];
    if (!target) {
      this.logger.warn(`DeepL does not support ${targetLocale}; skipping`);
      return [];
    }

    const res = await fetch(`${this.host}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        target_lang: target,
        ...(sourceLocale && SOURCE_LANGUAGE[sourceLocale]
          ? { source_lang: SOURCE_LANGUAGE[sourceLocale] }
          : {}),
        preserve_formatting: true,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`DeepL responded ${res.status}`);
    }
    const body = (await res.json()) as { translations?: Array<{ text: string }> };
    return (body.translations ?? []).map((t) => t.text);
  }
}
