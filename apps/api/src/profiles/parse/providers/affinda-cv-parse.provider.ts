import { Injectable } from '@nestjs/common';
import type { CvParseProvider } from '../cv-parse.provider';
import type { CvParseProviderInput, ParsedCvData } from '../cv-parse.types';

/**
 * Placeholder for Affinda Resume Parser.
 * Set CV_PARSE_PROVIDER=affinda and AFFINDA_API_KEY when integrating.
 */
@Injectable()
export class AffindaCvParseProvider implements CvParseProvider {
  readonly name = 'affinda';

  async parse(_input: CvParseProviderInput): Promise<ParsedCvData> {
    throw new Error(
      'Affinda CV parse provider is not configured. Set AFFINDA_API_KEY and implement AffindaCvParseProvider, or use CV_PARSE_PROVIDER=local.',
    );
  }
}
