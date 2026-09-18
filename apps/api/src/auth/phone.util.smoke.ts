import {
  generateOtpCode,
  maskPhone,
  normalizePhone,
  parsePhoneStartPayload,
  phoneLoginDeepLink,
} from './phone.util';
import { createSmsProviderFromEnv } from './sms.provider';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function normalizesUzbekFormats() {
  assert(normalizePhone('90 123 45 67') === '+998901234567', 'nine local digits get +998');
  assert(normalizePhone('998 90 123-45-67') === '+998901234567', 'twelve digits with 998 prefix');
  assert(normalizePhone('+998901234567') === '+998901234567', 'already E.164');
  assert(normalizePhone('+7 912 345 67 89') === '+79123456789', 'foreign numbers keep their country code');
  assert(normalizePhone('12345') === null, 'too short is rejected');
  assert(normalizePhone('') === null && normalizePhone(null) === null, 'empty is null');
}

function startPayloadAndDeepLink() {
  const token = 'a'.repeat(48);
  const link = phoneLoginDeepLink('@JobTalentioStagingBot', token);
  assert(link === `https://t.me/JobTalentioStagingBot?start=phone_${token}`, `deep link ${link}`);
  assert(parsePhoneStartPayload(`phone_${token}`) === token, 'payload round-trips');
  assert(parsePhoneStartPayload('phone_zz') === null, 'non-hex token rejected');
  assert(parsePhoneStartPayload(token) === null, 'link tokens without prefix are not phone logins');
}

function maskingAndCodes() {
  assert(maskPhone('+998901234567') === '+**********67', `mask ${maskPhone('+998901234567')}`);
  for (let i = 0; i < 20; i++) {
    assert(/^\d{6}$/.test(generateOtpCode()), 'six digit code');
  }
}

function smsProviderGuards() {
  assert(createSmsProviderFromEnv({}, true) === null, 'unset provider -> disabled');
  assert(createSmsProviderFromEnv({ SMS_PROVIDER: 'mock' }, true) === null, 'mock refused on public hosts');
  assert(createSmsProviderFromEnv({ SMS_PROVIDER: 'mock' }, false)?.name === 'mock', 'mock allowed locally');
  assert(
    createSmsProviderFromEnv({ SMS_PROVIDER: 'mock', SMS_MOCK_ALLOW_PUBLIC: '1' }, true)?.name === 'mock',
    'explicit override allows mock on staging',
  );
  assert(createSmsProviderFromEnv({ SMS_PROVIDER: 'eskiz' }, true) === null, 'eskiz without credentials -> disabled');
  assert(
    createSmsProviderFromEnv({ SMS_PROVIDER: 'eskiz', ESKIZ_EMAIL: 'a@b.uz', ESKIZ_PASSWORD: 'x' }, true)?.name === 'eskiz',
    'eskiz with credentials',
  );
}

normalizesUzbekFormats();
startPayloadAndDeepLink();
maskingAndCodes();
smsProviderGuards();
console.log('api: phone-util smoke ok');
