import type { ParsedCvData } from '../cv-parser';

export type CvParseProviderName = 'local' | 'affinda' | 'llm';

export type CvParseProviderInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  knownSkills: Array<{ name: string; slug: string }>;
};

export type { ParsedCvData };
