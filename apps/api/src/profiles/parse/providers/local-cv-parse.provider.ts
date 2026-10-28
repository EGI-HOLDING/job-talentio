import type { ConfigService } from '@nestjs/config';
import { parseCvText, stripNullBytesDeep } from '../../cv-parser';
import type { CvParseProvider } from '../cv-parse.provider';
import type { CvParseProviderInput, ParsedCvData } from '../cv-parse.types';
import { extractCvText } from '../cv-text-extract';

export class LocalCvParseProvider implements CvParseProvider {
  readonly name = 'local';

  constructor(private config?: ConfigService) {}

  async parse(input: CvParseProviderInput): Promise<ParsedCvData> {
    const { text, ocrUsed } = await extractCvText(input, this.config);

    const parsed = stripNullBytesDeep(parseCvText(text, input.knownSkills, input.knownLanguages));
    return {
      ...parsed,
      meta: { provider: this.name, ocrUsed, llmUsed: false },
    };
  }
}
