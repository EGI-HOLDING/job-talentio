import type { ConfigService } from '@nestjs/config';
import type { CvParseProvider } from './cv-parse.provider';
import type { CvParseProviderName } from './cv-parse.types';
import { LocalCvParseProvider } from './providers/local-cv-parse.provider';
import { AffindaCvParseProvider } from './providers/affinda-cv-parse.provider';
import { LlmCvParseProvider } from './providers/llm-cv-parse.provider';

export function resolveCvParseProviderName(raw?: string | null): CvParseProviderName {
  const v = (raw || 'local').trim().toLowerCase();
  if (v === 'affinda' || v === 'llm' || v === 'local') return v;
  return 'local';
}

export function createCvParseProvider(config: ConfigService): CvParseProvider {
  const name = resolveCvParseProviderName(config.get<string>('CV_PARSE_PROVIDER'));
  switch (name) {
    case 'affinda':
      return new AffindaCvParseProvider();
    case 'llm':
      return new LlmCvParseProvider();
    case 'local':
    default:
      return new LocalCvParseProvider(config);
  }
}
