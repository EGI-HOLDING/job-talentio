import type { CvCatalogLanguage, CvCatalogSkill, ParsedCvData } from '../cv-parser';

export type CvParseProviderName = 'local';

export type CvParseProviderInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  knownSkills: CvCatalogSkill[];
  knownLanguages: CvCatalogLanguage[];
};

export type { ParsedCvData };
