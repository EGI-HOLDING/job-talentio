import { Injectable } from '@nestjs/common';
import type { TranslationProvider, TranslateRequest } from '../translation.provider';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Google Cloud Translation v2 with an API key. Chosen over DeepL when Uzbek
 * matters, since Google is the only major provider that supports it.
 */
@Injectable()
export class GoogleTranslationProvider implements TranslationProvider {
  readonly name = 'google';

  constructor(
    private readonly apiKey: string,
    private readonly host = 'https://translation.googleapis.com',
  ) {}

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async translate({ texts, targetLocale, sourceLocale }: TranslateRequest): Promise<string[]> {
    const res = await fetch(
      `${this.host}/language/translate/v2?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: texts,
          target: targetLocale,
          ...(sourceLocale ? { source: sourceLocale } : {}),
          format: 'text',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      throw new Error(`Google Translation responded ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: { translations?: Array<{ translatedText: string }> };
    };
    return (body.data?.translations ?? []).map((t) => t.translatedText);
  }
}
