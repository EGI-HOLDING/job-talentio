import assert from 'node:assert/strict';
import { registerSchema } from '@job-talentio/shared';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { TelegramService } from '../telegram/telegram.service';
import type { PhoneAuthService } from './phone-auth.service';
import { DEFAULT_LOCALE } from '../common/i18n/locale';

const controller = new AuthController(
  { register: (input: unknown) => input } as AuthService,
  {} as TelegramService,
  {} as PhoneAuthService,
);
const input = {email: 'locale-check@example.test', password: 'ExampleOnly123!',
  fullName: 'Locale check', role: 'RECRUITER', acceptTerms: true};
const result = controller.register(input) as unknown as {locale: string};
assert.equal(result.locale, DEFAULT_LOCALE);
for (const locale of ['id','en','ru','uz']) {
  assert.equal((controller.register({...input, locale}) as unknown as {locale: string}).locale, locale);
}
for (const locale of [null, '', 'invalid']) assert.throws(() => controller.register({...input, locale}));
assert.throws(() => controller.register({...input, acceptTerms: false}));
assert.equal(registerSchema.parse(input).locale, 'uz', 'Shared schema compatibility must remain unchanged');
console.log(`PASS registration locale: omitted=${DEFAULT_LOCALE}, explicit supported values preserved, invalid inputs rejected, shared default unchanged`);
