import type { CvParseProviderInput, ParsedCvData } from './cv-parse.types';
import type { CvParseProviderName } from './cv-parse.types';

export const CV_PARSE_PROVIDER = Symbol('CV_PARSE_PROVIDER');

export interface CvParseProvider {
  readonly name: CvParseProviderName;
  parse(input: CvParseProviderInput): Promise<ParsedCvData>;
}
