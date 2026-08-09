import { Injectable } from '@nestjs/common';
import type { CvParseProvider } from '../cv-parse.provider';
import type { CvParseProviderInput, ParsedCvData } from '../cv-parse.types';

/**
 * Placeholder for LLM structured CV extract.
 * Set CV_PARSE_PROVIDER=llm and LLM_* credentials when integrating.
 */
@Injectable()
export class LlmCvParseProvider implements CvParseProvider {
  readonly name = 'llm';

  async parse(_input: CvParseProviderInput): Promise<ParsedCvData> {
    throw new Error(
      'LLM CV parse provider is not configured. Set LLM API credentials and implement LlmCvParseProvider, or use CV_PARSE_PROVIDER=local.',
    );
  }
}
