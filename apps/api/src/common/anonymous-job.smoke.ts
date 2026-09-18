import {
  anonymousEmployerName,
  displayCompanyName,
  maskAnonymousCompany,
  revealsAnonymousEmployer,
} from './anonymous-job';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const company = { id: 'c1', name: 'Orient Bank Digital', slug: 'orient-bank', logoUrl: 'x.png', isVerified: true };

function masksOnlyConfidentialPostings() {
  const open = maskAnonymousCompany({ id: 'j1', isAnonymous: false, company }, 'uz');
  assert(open.company.name === 'Orient Bank Digital', 'open posting keeps its company');

  const hidden = maskAnonymousCompany({ id: 'j2', isAnonymous: true, company }, 'ru');
  assert(hidden.company.name === 'Конфиденциальный работодатель', `masked name got ${hidden.company.name}`);
  assert((hidden.company as { anonymous?: boolean }).anonymous === true, 'masked company flagged');
  assert(hidden.company.id === '' && hidden.company.slug === '' && hidden.company.logoUrl === null, 'identifying fields dropped');
  assert(hidden.company.isVerified === false, 'verified badge would hint at the employer');
  assert(hidden.id === 'j2', 'job fields untouched');
}

function revealsAtInterviewStage() {
  assert(!revealsAnonymousEmployer('NEW') && !revealsAnonymousEmployer('IN_REVIEW'), 'early stages stay hidden');
  assert(revealsAnonymousEmployer('INTERVIEW') && revealsAnonymousEmployer('OFFER') && revealsAnonymousEmployer('HIRED'), 'interview and later reveal');
  assert(!revealsAnonymousEmployer(undefined), 'no application means no reveal');
  const revealed = maskAnonymousCompany({ isAnonymous: true, company }, 'en', { reveal: true });
  assert(revealed.company.name === 'Orient Bank Digital', 'reveal flag keeps the company');
}

function plainTextSurfaces() {
  assert(displayCompanyName({ isAnonymous: true }, 'UzPay', 'uz') === 'Maxfiy ish beruvchi', 'uz placeholder');
  assert(displayCompanyName({ isAnonymous: false }, 'UzPay', 'uz') === 'UzPay', 'open posting keeps name');
  assert(anonymousEmployerName('xx') === anonymousEmployerName('uz'), 'unknown locale falls back to Uzbek');
  assert(anonymousEmployerName('en') === 'Confidential employer', 'en placeholder');
}

masksOnlyConfidentialPostings();
revealsAtInterviewStage();
plainTextSurfaces();
console.log('api: anonymous-job smoke ok');
