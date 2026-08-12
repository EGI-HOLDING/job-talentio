import { Logger } from '@nestjs/common';
import type { OpenAiClient } from '../../common/openai/openai.client';
import type { TranslationProvider, TranslateRequest } from '../translation.provider';

const SYSTEM = `You are a professional translator for a job board (Uzbek, Russian, English).
Translate each input string into the target language. Preserve meaning, proper names, numbers, and formatting.
Return ONLY JSON: {"translations":["..."]} with the same length and order as the inputs.`;

/**
 * OpenAI Chat Completions MT. Supports uz/ru/en (unlike DeepL free for Uzbek).
 */
export class OpenAiTranslationProvider implements TranslationProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiTranslationProvider.name);

  constructor(private readonly client: OpenAiClient) {}

  get enabled(): boolean {
    return this.client.enabled;
  }

  async translate({ texts, targetLocale, sourceLocale }: TranslateRequest): Promise<string[]> {
    if (!texts.length) return [];

    const sourceHint = sourceLocale ? ` from ${sourceLocale}` : '';
    const user = `Target locale: ${targetLocale}${sourceHint}.\nInputs (JSON array):\n${JSON.stringify(texts)}`;

    try {
      const payload = await this.client.chatJson<{ translations?: unknown }>({
        system: SYSTEM,
        user,
        maxTokens: Math.min(4_000, Math.max(256, texts.join('').length + 200)),
      });

      const list = Array.isArray(payload.translations) ? payload.translations : null;
      if (!list || list.length !== texts.length) {
        this.logger.warn(
          `OpenAI MT returned unexpected shape (expected ${texts.length} items)`,
        );
        return [];
      }

      return list.map((item, i) => {
        if (typeof item === 'string' && item.trim()) return item;
        return texts[i];
      });
    } catch (err) {
      throw new Error(`OpenAI translation failed: ${(err as Error).message}`);
    }
  }
}
