import {
  googleTokenEmailVerified,
  shouldMarkGoogleMailboxVerified,
  telegramTypedEmailVerified,
} from './oauth-email-verified';
import { scoreProfileCompleteness } from '@job-talentio/shared';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function googleTrustsVerifiedTokenEmail() {
  assert(googleTokenEmailVerified({ email_verified: true }), 'true flag dropped');
  assert(!googleTokenEmailVerified({ email_verified: false }), 'false flag trusted');
  assert(!googleTokenEmailVerified({}), 'missing flag treated as verified');
  assert(
    shouldMarkGoogleMailboxVerified({
      tokenEmail: 'ada@gmail.com',
      tokenEmailVerified: true,
      storedEmail: 'ada@gmail.com',
    }),
    'matching Google mailbox not trusted',
  );
  assert(
    !shouldMarkGoogleMailboxVerified({
      tokenEmail: 'ada@gmail.com',
      tokenEmailVerified: true,
      storedEmail: 'other@jobtalent.io',
    }),
    'changed Settings email must not inherit Google verify',
  );
  assert(
    !shouldMarkGoogleMailboxVerified({
      tokenEmail: 'ada@gmail.com',
      tokenEmailVerified: false,
      storedEmail: 'ada@gmail.com',
    }),
    'unverified Google token must not mark mailbox',
  );
}

function telegramTypedInboxStaysUnverified() {
  assert(!telegramTypedEmailVerified(), 'Telegram typed email must stay unverified');
}

function emptyOauthProfileIsZeroPercent() {
  const googleOnlyPhoto = scoreProfileCompleteness({
    avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
    email: 'battaliondev@gmail.com',
    emailVerified: true,
    telegramLinked: false,
  });
  assert(googleOnlyPhoto.percent === 0, `Google photo scored ${googleOnlyPhoto.percent}`);
  assert(
    !googleOnlyPhoto.missing.some((item) => item.id === 'contact' || item.id === 'photo'),
    'verified Google with photo should not nag contact or photo',
  );

  const telegramOnly = scoreProfileCompleteness({
    avatarUrl: 'https://t.me/i/userpic/320/abc.jpg',
    email: null,
    emailVerified: false,
    telegramLinked: true,
  });
  assert(telegramOnly.percent === 0, `Telegram photo scored ${telegramOnly.percent}`);
  assert(
    !telegramOnly.missing.some((item) => item.id === 'contact'),
    'Telegram-only must not nag verify-email',
  );
  assert(
    telegramOnly.missing.some((item) => item.id === 'optionalEmail'),
    'Telegram-only should still offer add-email after career chips',
  );
  assert(telegramOnly.missing[0].id === 'headline', 'career chips must come first');
}

function careerWeightsMatchPlan() {
  const partial = scoreProfileCompleteness({
    headline: 'Frontend developer',
    city: { id: 'tashkent' },
    skills: [{}, {}, {}],
  });
  assert(partial.percent === 40, `headline+city+3 skills should be 40, got ${partial.percent}`);

  const passwordUnverified = scoreProfileCompleteness({
    email: 'ada@jobtalent.io',
    emailVerified: false,
    telegramLinked: false,
  });
  assert(passwordUnverified.percent === 0, 'password signup must not score from identity');
  assert(
    passwordUnverified.missing.some((item) => item.id === 'contact' && item.labelKey === 'emp.checkVerifyEmail'),
    'password signup should ask to verify email',
  );
}

googleTrustsVerifiedTokenEmail();
telegramTypedInboxStaysUnverified();
emptyOauthProfileIsZeroPercent();
careerWeightsMatchPlan();
console.log('api: oauth identity / profile completeness smoke ok');
