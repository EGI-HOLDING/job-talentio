import assert from 'node:assert/strict';
import 'reflect-metadata';
import {
  normalizeE164Phone,
  phoneCountryOptions,
  phoneDraftFromE164,
  validatePhoneDraft,
} from '@job-talentio/shared';
import { ProfilesService } from './profiles.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';

const valid = (country: string, nationalNumber: string) =>
  validatePhoneDraft({ country, nationalNumber });

assert.deepEqual(valid('ID', '81234567890'), { ok: true, phone: '+6281234567890' });
assert.deepEqual(valid('UZ', '901234567'), { ok: true, phone: '+998901234567' });
assert.deepEqual(valid('ID', '081234567890'), { ok: false, error: 'PHONE_NATIONAL_PREFIX' });
assert.deepEqual(valid('ID', '6281234567890'), { ok: false, error: 'PHONE_COUNTRY_CODE_REPEATED' });
assert.deepEqual(valid('ID', '+6281234567890'), { ok: false, error: 'PHONE_COUNTRY_CODE_REPEATED' });
assert.deepEqual(valid('ID', '+998901234567'), { ok: false, error: 'PHONE_COUNTRY_CODE_MISMATCH' });
assert.equal(valid('ID', '81234').ok, false);
assert.equal(valid('ID', '812345678901234567').ok, false);
assert.deepEqual(valid('IT', '0212345678'), { ok: true, phone: '+390212345678' });

const canada = valid('CA', '6042345678');
assert.equal(canada.ok, true, 'a valid Canadian number should pass for Canada');
assert.deepEqual(valid('US', '6042345678'), { ok: false, error: 'PHONE_INVALID' }, 'shared +1 calling codes must still respect the selected region');

const options = phoneCountryOptions('en');
const us = options.find((country) => country.country === 'US');
const ca = options.find((country) => country.country === 'CA');
assert.ok(us && ca);
assert.equal(us.dialCode, '+1');
assert.equal(ca.dialCode, '+1');
assert.ok(options.some((country) => country.country === 'ID' && country.dialCode === '+62'));
assert.ok(options.some((country) => country.country === 'UZ' && country.dialCode === '+998'));

assert.equal(normalizeE164Phone('+6281234567890'), '+6281234567890');
assert.equal(normalizeE164Phone('+998901000000'), '+998901000000');
assert.equal(normalizeE164Phone('+6281210000000'), '+6281210000000');
assert.equal(normalizeE164Phone('081234567890'), null);
assert.equal(normalizeE164Phone('+62081234567890'), null);
assert.deepEqual(phoneDraftFromE164('+14162345678', 'CA'), {
  country: 'CA',
  nationalNumber: '4162345678',
});

const profile = { id: 'employee-profile', onboardingStatus: 'COMPLETED' };
async function main() {
const phoneWrites: string[] = [];
let duplicate = false;
const profileService = Object.create(ProfilesService.prototype) as any;
profileService.getProfileForUser = async () => profile;
profileService.prisma = {
  employeeProfile: {
    findFirst: async () => duplicate ? { id: 'another-profile' } : null,
    update: async ({ data }: { data: { phone?: string } }) => {
      if (data.phone) phoneWrites.push(data.phone);
      return { ...profile, phone: data.phone };
    },
  },
};
await assert.rejects(profileService.updateProfile({ id: 'employee' }, { phone: '' }), /PHONE_REQUIRED/);
await assert.rejects(profileService.updateProfile({ id: 'employee' }, { phone: '081234567890' }), /PHONE_INVALID/);
duplicate = true;
await assert.rejects(profileService.updateProfile({ id: 'employee' }, { phone: '+6281234567890' }), /PHONE_DUPLICATE/);
duplicate = false;
await profileService.updateProfile({ id: 'employee' }, { phone: '+6281234567890' });
assert.deepEqual(phoneWrites, ['+6281234567890'], 'only EmployeeProfile.phone is updated');

const onboardingService = Object.create(EmployeeOnboardingService.prototype) as any;
const onboardingProfile = {
  desiredPositions: ['Frontend Developer'],
  preferredCountries: [{ id: 'country-id' }],
  residenceCountryId: 'country-id',
  user: { fullName: 'Test Employee' },
  phone: null,
};
assert.doesNotThrow(() => onboardingService.validate(onboardingProfile, 4));
assert.throws(() => onboardingService.validate(onboardingProfile, 5), /PHONE_REQUIRED/);
assert.doesNotThrow(() => onboardingService.validate({ ...onboardingProfile, phone: '+6281234567890' }, 5));

console.log('phone-number: smoke ok');
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
