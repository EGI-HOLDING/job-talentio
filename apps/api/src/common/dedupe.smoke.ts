import {
  type ActiveJobDedupeSnapshot,
  canonicalStoredFingerprint,
  inventoryActiveJobDuplicates,
  jobFingerprint,
  normalizeJobTitle,
  pickActiveDuplicateWinner,
  titlesNearlyIdentical,
} from './dedupe';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function snapshot(
  partial: Partial<ActiveJobDedupeSnapshot> & Pick<ActiveJobDedupeSnapshot, 'id' | 'title'>,
): ActiveJobDedupeSnapshot {
  return {
    companyId: 'co1',
    companyName: 'Khorezm Green Energy',
    companySlug: 'khorezm-green',
    workMode: 'ONSITE',
    cityId: 'city-tashkent',
    cityName: 'Tashkent',
    status: 'PUBLISHED',
    fingerprint: null,
    contentHash: null,
    createdAt: new Date('2026-08-06T03:57:33.000Z'),
    applicationCount: 0,
    ...partial,
  };
}

assert(
  jobFingerprint({ title: 'Power BI Developer!', workMode: 'ONSITE', cityId: 'c1' }) ===
    jobFingerprint({ title: 'power bi developer', workMode: 'ONSITE', cityId: 'c1' }),
  'jobFingerprint must ignore title punctuation via normalizeJobTitle',
);
assert(
  normalizeJobTitle('Power BI Developer!') === 'power bi developer',
  'normalizeJobTitle strips punctuation',
);

const forged =
  '8254e9f8f81036c6b459f0737f504aef68f13fc54b96da72d65a2f2e67183940:g1fx4jj3';
assert(
  canonicalStoredFingerprint(forged) ===
    '8254e9f8f81036c6b459f0737f504aef68f13fc54b96da72d65a2f2e67183940',
  'canonicalStoredFingerprint strips :id suffix',
);
assert(
  canonicalStoredFingerprint(
    '8254e9f8f81036c6b459f0737f504aef68f13fc54b96da72d65a2f2e67183940',
  ) === '8254e9f8f81036c6b459f0737f504aef68f13fc54b96da72d65a2f2e67183940',
  'canonicalStoredFingerprint keeps a bare SHA-256',
);
assert(canonicalStoredFingerprint(null) === null, 'null fingerprint stays null');

const published = snapshot({
  id: 'older-published',
  title: 'Power BI Developer',
  status: 'PUBLISHED',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  applicationCount: 0,
});
const draft = snapshot({
  id: 'newer-draft',
  title: 'Power BI Developer',
  status: 'DRAFT',
  createdAt: new Date('2026-08-10T00:00:00.000Z'),
  applicationCount: 9,
});
assert(
  pickActiveDuplicateWinner([draft, published]).id === 'older-published',
  'PUBLISHED beats DRAFT even when the draft is newer and has applications',
);

const emptyNew = snapshot({
  id: 'empty-new',
  title: 'Power BI Developer',
  createdAt: new Date('2026-08-12T00:00:00.000Z'),
  applicationCount: 0,
});
const busyOld = snapshot({
  id: 'busy-old',
  title: 'Power BI Developer',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  applicationCount: 4,
});
assert(
  pickActiveDuplicateWinner([emptyNew, busyOld]).id === 'busy-old',
  'more applications beat a newer empty post of the same status',
);

assert(titlesNearlyIdentical('Power BI Developer', 'Power BI Developer'), 'exact titles match');
assert(
  titlesNearlyIdentical('React Developer', 'React Developers'),
  'containment near-title matches when the shorter title is at least 85 percent of the longer',
);

const twinA = snapshot({
  id: 'cmsgzj4gl023hucoo123e5r1y',
  title: 'Power BI Developer',
  fingerprint: '8254e9f8f81036c6b459f0737f504aef68f13fc54b96da72d65a2f2e67183940',
  createdAt: new Date('2026-08-06T03:57:33.141Z'),
});
const twinB = snapshot({
  id: 'cmsgzj58702mkucoog1fx4jj3',
  title: 'Power BI Developer',
  fingerprint: forged,
  createdAt: new Date('2026-08-06T03:57:34.136Z'),
});
const inventory = inventoryActiveJobDuplicates([twinA, twinB]);
assert(inventory.counts.A >= 1, 'forged fingerprint pair is class A');
assert(inventory.counts.B >= 1, 'same normalized title is class B');
assert(inventory.jobsToClose === 1, 'exactly one of the Power BI twins would close');
assert(
  inventory.groups.some((g) => g.winnerId === 'cmsgzj58702mkucoog1fx4jj3'),
  'newer createdAt wins when status and applications tie',
);

const otherCompany = snapshot({
  id: 'other-co',
  companyId: 'co2',
  companySlug: 'andijan-agrotech',
  title: 'Power BI Developer',
});
const mixed = inventoryActiveJobDuplicates([twinA, otherCompany]);
assert(
  mixed.jobsToClose === 0 && mixed.counts.A === 0 && mixed.counts.B === 0,
  'same title at two companies is not a duplicate',
);

console.log('api: dedupe smoke ok');
