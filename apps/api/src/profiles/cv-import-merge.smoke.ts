import {
  educationImportKey,
  experienceImportKey,
  pickFilledProfileFields,
  resumeStartDate,
} from './cv-import-merge';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const missing = resumeStartDate(null);
assert(missing === null, 'missing start date must stay null');
assert(resumeStartDate('   ') === null, 'blank start date must stay null');
assert(resumeStartDate('2020-01-01') instanceof Date, 'a real date still parses');

const key = experienceImportKey('Frontend Developer', 'UzPay', '2020-01-01');
assert(
  key === experienceImportKey('frontend developer', 'uzpay', new Date('2020-01-01T00:00:00Z')),
  'same role, company, and date is one experience',
);
assert(
  experienceImportKey('Frontend Developer', 'UzPay', '2021-01-01') !== key,
  'a different year is a different experience',
);

assert(
  educationImportKey('TUIT', 'BACHELOR', '2016-01-01') !==
    educationImportKey('tuit', 'BACHELOR', new Date('2016-09-01T00:00:00Z')),
  'different start dates in one year are distinct educations',
);
assert(key !== experienceImportKey('Frontend Developer', 'UzPay', '2020-06-01'), 'a second stint in the same year must survive import');
assert(resumeStartDate('2024-02-31') === null, 'invalid dates must not roll forward into March');

const kept = pickFilledProfileFields(
  { headline: 'ML Engineer', summary: '', phone: '+998901112233' },
  { headline: 'Data Engineer', summary: 'New summary', phone: '+998900000000' },
  false,
);
assert(kept.headline === undefined, 'filled headline must stay');
assert(kept.summary === 'New summary', 'empty summary can be filled');
assert(kept.phone === undefined, 'filled phone must stay');

const replaced = pickFilledProfileFields(
  { headline: 'ML Engineer' },
  { headline: 'Data Engineer' },
  true,
);
assert(replaced.headline === 'Data Engineer', 'explicit replace may overwrite headline');

console.log('api: cv-import-merge smoke ok');
