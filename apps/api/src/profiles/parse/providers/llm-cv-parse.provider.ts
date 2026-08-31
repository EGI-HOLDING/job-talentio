import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createOpenAiClient, type OpenAiClient } from '../../../common/openai/openai.client';
import { parseCvText, stripNullBytesDeep } from '../../cv-parser';
import type { CvParseProvider } from '../cv-parse.provider';
import type { CvParseProviderInput, ParsedCvData } from '../cv-parse.types';
import { extractCvText } from '../cv-text-extract';
import {
  isCvTextRichEnoughForLlm,
  LLM_CV_SYSTEM_PROMPT,
  normalizeLlmCvPayload,
  truncateCvTextForLlm,
} from '../llm-cv-normalize';

/**
 * LLM-primary CV parse: local text extract → OpenAI JSON structure → local fallback.
 */
export class LlmCvParseProvider implements CvParseProvider {
  readonly name = 'llm';
  private readonly logger = new Logger(LlmCvParseProvider.name);
  private readonly openai: OpenAiClient;

  constructor(private config: ConfigService, openai?: OpenAiClient) {
    this.openai = openai ?? createOpenAiClient(config);
  }

  async parse(input: CvParseProviderInput): Promise<ParsedCvData> {
    const { kind, text, ocrUsed } = await extractCvText(input, this.config);

    if (kind === 'other') {
      const parsed = stripNullBytesDeep(parseCvText('', input.knownSkills));
      return {
        ...parsed,
        textPreview:
          'Structured parse supports PDF and DOCX; file is stored for download.',
        meta: { provider: this.name, ocrUsed: false, llmUsed: false },
      };
    }

    if (!isCvTextRichEnoughForLlm(text) || !this.openai.enabled) {
      if (!this.openai.enabled) {
        this.logger.warn('OPENAI_API_KEY missing; falling back to local CV parse');
      }
      return this.localFallback(text, input.knownSkills, ocrUsed);
    }

    try {
      const truncated = truncateCvTextForLlm(text);
      const payload = await this.openai.chatJson<unknown>({
        system: LLM_CV_SYSTEM_PROMPT,
        user: truncated,
        maxTokens: 6_000,
      });
      return normalizeLlmCvPayload(payload, {
        sourceText: text,
        knownSkills: input.knownSkills,
        ocrUsed,
      });
    } catch (err) {
      this.logger.warn(`LLM CV parse failed, using local fallback: ${(err as Error).message}`);
      return this.localFallback(text, input.knownSkills, ocrUsed);
    }
  }

  private localFallback(
    text: string,
    knownSkills: Array<{ name: string; slug: string }>,
    ocrUsed: boolean,
  ): ParsedCvData {
    const parsed = stripNullBytesDeep(parseCvText(text, knownSkills));
    return {
      ...parsed,
      meta: { provider: this.name, ocrUsed, llmUsed: false },
    };
  }
}
