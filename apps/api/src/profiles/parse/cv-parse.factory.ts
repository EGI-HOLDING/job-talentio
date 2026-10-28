import type { ConfigService } from '@nestjs/config';
import type { CvParseProvider } from './cv-parse.provider';
import { LocalCvParseProvider } from './providers/local-cv-parse.provider';

export function createCvParseProvider(config: ConfigService): CvParseProvider {
  // CV parsing is a free feature. Legacy environment settings cannot enable
  // a paid provider, and OpenAI credentials are never read by this factory.
  return new LocalCvParseProvider(config);
}
