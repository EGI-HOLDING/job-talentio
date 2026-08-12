import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAiClient } from '../common/openai/openai.client';
import { PrismaModule } from '../prisma/prisma.module';
import { TRANSLATION_PROVIDER } from './translation.provider';
import type { TranslationProvider } from './translation.provider';
import { NoopTranslationProvider } from './providers/noop-translation.provider';
import { DeeplTranslationProvider } from './providers/deepl-translation.provider';
import { GoogleTranslationProvider } from './providers/google-translation.provider';
import { OpenAiTranslationProvider } from './providers/openai-translation.provider';
import { TranslationService } from './translation.service';

/**
 * Machine translation is opt-in: without TRANSLATION_PROVIDER (or without a
 * key) the no-op provider keeps the feature disabled and free.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: TRANSLATION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): TranslationProvider => {
        const logger = new Logger('TranslationProvider');
        const choice = (config.get<string>('TRANSLATION_PROVIDER') || 'none').toLowerCase();

        if (choice === 'none') return new NoopTranslationProvider();

        if (choice === 'openai') {
          const client = createOpenAiClient(config, {
            apiKeyFallback: config.get<string>('TRANSLATION_API_KEY') || '',
          });
          if (!client.enabled) {
            logger.warn(
              'TRANSLATION_PROVIDER=openai but OPENAI_API_KEY (and TRANSLATION_API_KEY) is empty; disabled',
            );
            return new NoopTranslationProvider();
          }
          logger.log('Machine translation provider: openai');
          return new OpenAiTranslationProvider(client);
        }

        const apiKey = config.get<string>('TRANSLATION_API_KEY') || '';
        if (!apiKey) {
          logger.warn(`TRANSLATION_PROVIDER=${choice} but TRANSLATION_API_KEY is empty; disabled`);
          return new NoopTranslationProvider();
        }

        if (choice === 'deepl') {
          logger.log('Machine translation provider: deepl');
          return new DeeplTranslationProvider(apiKey);
        }
        if (choice === 'google') {
          logger.log('Machine translation provider: google');
          return new GoogleTranslationProvider(apiKey);
        }

        logger.warn(`Unknown TRANSLATION_PROVIDER "${choice}"; machine translation disabled`);
        return new NoopTranslationProvider();
      },
    },
    TranslationService,
  ],
  exports: [TRANSLATION_PROVIDER, TranslationService],
})
export class TranslationModule {}
