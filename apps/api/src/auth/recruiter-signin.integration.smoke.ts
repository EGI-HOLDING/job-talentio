import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { registerSchema, googleOAuthSchema, telegramOAuthSchema, phoneLoginStartSchema } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { PhoneAuthService } from './phone-auth.service';
import { TelegramService } from '../telegram/telegram.service';
import { RecruiterOnboardingService } from '../benefits/recruiter-onboarding.service';
import { BenefitsService } from '../benefits/benefits.service';
import { OperationsService } from '../benefits/operations.service';

async function main() {
  assert.equal(process.env.DATABASE_URL, process.env.HR_TEST_DATABASE_URL);
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/talentio_hr_it_\d+$/);
  const db = new PrismaService(); await db.$connect();
  try {
    const auth = new AuthService(db, {signAsync: async () => 'test-session'} as never,
      new ConfigService({}), {send: async () => true} as never, {} as never, {} as never, {} as never);
    Object.assign(auth, {verifyGoogleIdToken: async () => ({googleId: 'new-google', email: 'hr@example.test',
      fullName: 'New HR', emailVerified: true, avatarUrl: null})});
    const google = await auth.oauthGoogle(googleOAuthSchema.parse({idToken: 'x'.repeat(30), expectedRole: 'RECRUITER'}));
    assert.ok('accessToken' in google);
    assert.equal(google.user.recruiterOnboarding?.status, 'IN_PROGRESS');
    assert.equal(google.user.memberships.length, 0);
    const returning = await auth.oauthGoogle({idToken: 'test', expectedRole: 'RECRUITER'});
    assert.equal(returning.user.id, google.user.id);
    await assert.rejects(() => auth.oauthGoogle({idToken: 'test', expectedRole: 'EMPLOYEE'}), /AUTH_ROLE_MISMATCH/);

    Object.assign(auth, {parseTelegramAuth: () => ({telegramId: 'new-telegram', fullName: 'Telegram HR', username: 'hr', avatarUrl: null})});
    const telegram = await auth.oauthTelegram(telegramOAuthSchema.parse({id: '123', first_name: 'HR', hash: 'x'.repeat(64), auth_date: 1, expectedRole: 'RECRUITER'}));
    assert.ok('accessToken' in telegram);
    assert.equal(telegram.user.recruiterOnboarding?.status, 'IN_PROGRESS');
    const password = await auth.register(registerSchema.parse({email: 'password@example.test', password: 'Test-pass-123!', fullName: 'Password HR', role: 'RECRUITER', acceptTerms: true}));
    assert.equal(password.user.recruiterOnboarding?.status, 'IN_PROGRESS');
    assert.equal(await db.company.count(), 0, 'sign-in must not create placeholder companies');

    const phone = new PhoneAuthService(db, new ConfigService({TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_BOT_USERNAME: 'test', API_URL: 'https://example.test'}), auth, {} as never);
    const start = await phone.startTelegramLogin('en', phoneLoginStartSchema.parse({role: 'RECRUITER'}).role);
    await (TelegramService.prototype as any).handlePhoneStart.call({prisma: db, sendMessage: async () => undefined}, '999', 'phone_' + start.token, 'en');
    await (TelegramService.prototype as any).handleContact.call({prisma: db, sendMessage: async () => undefined}, '999', {user_id: 999, phone_number: '+998901234567'}, {id: 999, first_name: 'Phone HR'}, null, 'en');
    const phoneLogin = await phone.telegramLoginStatus(start.token);
    assert.equal(phoneLogin.status, 'COMPLETED');
    if (phoneLogin.status === 'COMPLETED') {
      assert.equal(phoneLogin.session.user.role, 'RECRUITER');
      assert.equal(phoneLogin.session.user.recruiterOnboarding?.status, 'IN_PROGRESS');
    }

    const country = await db.country.create({data: {name: 'Test country', slug: 'test', iso2: 'ZZ', iso3: 'ZZZ', phoneCode: '+999'}});
    const province = await db.province.create({data: {name: 'Test region', slug: 'test', countryId: country.id}});
    const city = await db.city.create({data: {name: 'Test city', slug: 'test-city', provinceId: province.id}});
    const industry = await db.industry.create({data: {name: 'Test industry', slug: 'test-industry', group: {create: {name: 'Test group', slug: 'test-group'}}}});
    const onboarding = new RecruiterOnboardingService(db, new BenefitsService(db, new OperationsService(db)));
    const actor = await db.user.findUniqueOrThrow({where: {id: google.user.id}});
    const companyDraft = {name: 'Real company', description: 'A real employer company description.', website: '', size: 'SIZE_1_10', countryId: country.id, citySlug: city.slug, industrySlug: industry.slug};
    await onboarding.save(actor, {companyId: null, step: 1, companyDraft});
    assert.deepEqual((await onboarding.state(actor)).companyDraft, companyDraft, 'draft survives reload before company creation');
    await assert.rejects(() => onboarding.save(actor, {step: 2, companyDraft: {...companyDraft, citySlug: 'missing'}}));
    assert.equal(await db.company.count(), 0, 'invalid company must roll back entirely');
    const [first, replay] = await Promise.all([onboarding.save(actor, {step: 2, companyDraft}), onboarding.save(actor, {step: 2, companyDraft})]);
    assert.equal(first.companyId, replay.companyId, 'replayed submission creates one company');
    assert.equal(await db.company.count(), 1);
    assert.equal((await onboarding.state(actor)).memberships[0].role, 'OWNER');
    await onboarding.complete(actor, true);
    assert.equal((await auth.me(actor.id)).user.recruiterOnboarding?.status, 'COMPLETE');
    assert.equal((await auth.oauthGoogle({idToken: 'test', expectedRole: 'RECRUITER'})).user.recruiterOnboarding?.status, 'COMPLETE');
    await db.recruiterOnboarding.update({where: {userId: actor.id}, data: {status: 'NOT_REQUIRED'}});
    assert.equal((await auth.me(actor.id)).user.recruiterOnboarding?.status, 'NOT_REQUIRED', 'legacy account does not re-enter onboarding');
    console.log('Recruiter sign-in: new/existing Google, Telegram, phone, password, draft resume, atomic company creation and completion passed.');
  } finally { await db.$disconnect(); }
}
void main().catch(error => {console.error(error); process.exitCode = 1;});
