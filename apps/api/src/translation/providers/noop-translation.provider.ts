import { Injectable } from '@nestjs/common';
import type { TranslationProvider, TranslateRequest } from '../translation.provider';

/**
 * Default provider: machine translation is off unless an operator opts in.
 * Keeps the feature free by default and makes "no API key" a normal state
 * rather than an error path.
 */
@Injectable()
export class NoopTranslationProvider implements TranslationProvider {
  readonly name = 'none';
  readonly enabled = false;

  async translate(_input: TranslateRequest): Promise<string[]> {
    return [];
  }
}
