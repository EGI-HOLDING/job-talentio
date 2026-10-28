import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

const user = {
  id: 'account-1', role: 'RECRUITER', email: 'existing@example.test',
  fullName: 'Existing Employer', tokenVersion: 0, isBanned: false,
  emailVerified: true, googleId: 'google-existing', avatarUrl: null,
  memberships: [], employeeProfile: null,
};

function service(prisma: unknown, companies: unknown = {}) {
  return new AuthService(
    {recruiterOnboarding: {upsert: async () => ({status: 'NOT_REQUIRED', step: 1})}, ...(prisma as object)} as never, { signAsync: async () => 'access-token' } as never,
    new ConfigService({}), {} as never, {} as never, companies as never, {} as never,
  );
}

async function main() {
  let issued = 0;
  const tokens = {
    create: async () => { issued += 1; },
    deleteMany: async () => ({ count: 0 }),
  };
  const current = service({ user: { findUniqueOrThrow: async () => user }, refreshToken: tokens });
  const me = await current.me(user.id);
  assert.equal(me.user.id, user.id);
  assert.equal(issued, 0, 'reading /auth/me must not create another refresh token');
  const login = await current.sessionForUser(user.id);
  assert.ok(login.refreshToken, 'a new login still needs a refresh token');
  assert.equal(issued, 1);
  assert.equal(login.user.recruiterOnboarding?.status, 'NOT_REQUIRED');
  const newRecruiter = service({user: {findUniqueOrThrow: async () => user}, refreshToken: tokens,
    recruiterOnboarding: {upsert: async () => ({status: 'IN_PROGRESS', step: 2})}});
  assert.deepEqual((await newRecruiter.me(user.id)).user.recruiterOnboarding, {status: 'IN_PROGRESS', step: 2});

  for (const match of ['googleId', 'email']) {
    const oauth = service({
      user: {
        findUnique: async ({ where }: { where: { googleId?: string; email?: string } }) =>
          (match === 'googleId' && where.googleId) || where.email ? user : null,
        update: async () => user,
        findUniqueOrThrow: async () => user,
      },
      refreshToken: tokens,
    });
    // Provider verification is isolated; exercise the real existing-account decision.
    Object.assign(oauth, { verifyGoogleIdToken: async () => ({
      googleId: 'google-existing', email: user.email,
      fullName: user.fullName, emailVerified: true, avatarUrl: null,
    }) });
    const result = await oauth.oauthGoogle({ idToken: 'provider-token', expectedRole: 'RECRUITER' });
    assert.ok('accessToken' in result, `existing account matched by ${match} must log in`);
    assert.ok(!('requiresRegistration' in result), 'an existing employer must not see company registration');
  }

  let linkedUnverified = false;
  const unverified = service({ user: {
    findUnique: async ({ where }: { where: { email?: string } }) => where.email ? user : null,
    update: async () => { linkedUnverified = true; return user; },
    findUniqueOrThrow: async () => user,
  }, refreshToken: tokens });
  Object.assign(unverified, { verifyGoogleIdToken: async () => ({
    googleId: 'unlinked-subject', email: user.email, fullName: user.fullName,
    emailVerified: false, avatarUrl: null,
  }) });
  await assert.rejects(unverified.oauthGoogle({ idToken: 'provider-token' }), /not verified/);
  assert.equal(linkedUnverified, false, 'an unverified provider email cannot take over an existing account');

  const expiredInvite = service({ user: {
    findUnique: async () => user,
    findUniqueOrThrow: async () => user,
  }, refreshToken: tokens }, {
    consumeInviteForExistingUser: async () => { throw new BadRequestException('This invitation is invalid or has expired'); },
  });
  Object.assign(expiredInvite, { verifyGoogleIdToken: async () => ({
    googleId: user.googleId, email: user.email, fullName: user.fullName,
    emailVerified: true, avatarUrl: null,
  }) });
  await assert.rejects(expiredInvite.oauthGoogle({ idToken: 'provider-token', inviteToken: 'expired-invite' }), /expired/);

  for (const storedEmail of [user.email, null]) {
    let acceptedEmail: string | null = null;
    const telegramUser = { ...user, email: storedEmail, telegramId: 'telegram-account' };
    const telegram = service({ user: {
      findUnique: async ({ where }: { where: { telegramId?: string } }) => where.telegramId ? telegramUser : null,
      findUniqueOrThrow: async () => telegramUser,
    }, refreshToken: tokens }, {
      consumeInviteForExistingUser: async (_token: string, email: string) => {
        acceptedEmail = email;
        return { companyId: 'inviting-company' };
      },
    });
    Object.assign(telegram, { parseTelegramAuth: () => ({
      telegramId: 'telegram-account', fullName: user.fullName, username: 'test', avatarUrl: null,
    }) });
    const input = { id: '1', first_name: 'Test', auth_date: 1, hash: 'signed-provider-payload', inviteToken: 'valid-invite' };
    if (!storedEmail) {
      const first = await telegram.oauthTelegram(input);
      assert.ok('requiresRegistration' in first, 'email-less account must be asked for the invitation mailbox');
      assert.equal(acceptedEmail, null);
    }
    const joined = await telegram.oauthTelegram({ ...input, ...(storedEmail ? {} : { email: user.email }) });
    assert.ok('accessToken' in joined);
    assert.equal(joined.joinedCompanyId, 'inviting-company');
    assert.equal(acceptedEmail, user.email);
  }

  issued = 0;
  let claimed = false;
  const record = {
    id: 'refresh-1', userId: user.id, revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const rotating = service({
    user: { findUnique: async () => user, findUniqueOrThrow: async () => user },
    refreshToken: {
      ...tokens,
      findUnique: async () => ({ ...record }),
      update: async () => { claimed = true; },
      updateMany: async () => {
        const count = claimed ? 0 : 1;
        claimed = true;
        return { count };
      },
    },
  });
  const results = await Promise.allSettled([rotating.refresh('same-token'), rotating.refresh('same-token')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1,
    'parallel redemption must not issue two sessions from one refresh token');
  assert.equal(issued, 1);
  console.log('api: auth session / existing Google account smoke ok');
}
void main();
