import assert from 'node:assert/strict';
import {
  effectiveFeaturedPackageCode,
  isFeaturedBenefitActive,
  orderFeaturedJobs,
  type FeaturedJobCandidate,
} from './featured-job-order';

const at = (day: number) => new Date(Date.UTC(2026, 9, day));
const now = at(29);
const job = (
  id: string,
  companyId: string,
  packageCode: string,
  day: number,
  boostActive = false,
): FeaturedJobCandidate => ({ id, companyId, packageCode, publishedAt: at(day), boostActive });

const ordered = orderFeaturedJobs([
  job('free-new', 'company-free', 'FREE', 29),
  job('standard-old', 'company-standard', 'STANDARD', 1),
  job('premium-old', 'company-premium', 'PREMIUM', 1),
  job('premium-boost', 'company-boost', 'PREMIUM', 2, true),
  job('premium-new', 'company-premium', 'PREMIUM', 29),
  job('standard-new', 'company-standard', 'STANDARD', 29),
  job('standard-boost', 'company-standard-boost', 'STANDARD', 2, true),
]);

assert.deepEqual(
  ordered.map((item) => item.id),
  [
    'premium-boost',
    'premium-new',
    'premium-old',
    'standard-boost',
    'standard-new',
    'standard-old',
    'free-new',
  ],
  'package tiers dominate recency; boost and freshness order within each tier',
);

const diversified = orderFeaturedJobs([
  job('a-1', 'a', 'PREMIUM', 29),
  job('a-2', 'a', 'PREMIUM', 28),
  job('b-1', 'b', 'PREMIUM', 27),
  job('c-1', 'c', 'PREMIUM', 26),
  job('a-3', 'a', 'PREMIUM', 25),
]);
assert.deepEqual(
  diversified.map((item) => item.id),
  ['a-1', 'b-1', 'c-1', 'a-2', 'a-3'],
  'company round-robin reduces repetition within a package tier and remains stable',
);

const tied = orderFeaturedJobs([
  job('z-id', 'z', 'STANDARD', 20),
  job('a-id', 'a', 'STANDARD', 20),
]);
assert.deepEqual(tied.map((item) => item.id), ['a-id', 'z-id'], 'ID is a stable final tie-breaker');

assert.equal(effectiveFeaturedPackageCode(null, now), 'FREE', 'missing benefit defaults to Free');
assert.equal(effectiveFeaturedPackageCode({ code: 'PREMIUM', startsAt: at(1), expiresAt: at(28) }, now), 'FREE', 'expired premium has no active priority');
assert.equal(effectiveFeaturedPackageCode({ code: 'PREMIUM', startsAt: at(30), expiresAt: at(31) }, now), 'FREE', 'future package is not active');
assert.equal(effectiveFeaturedPackageCode({ code: 'STANDARD', startsAt: at(1), expiresAt: at(30) }, now), 'STANDARD');
assert.equal(isFeaturedBenefitActive({ code: 'FREE', startsAt: at(1), expiresAt: null }, now), true, 'an active unbounded benefit is valid');

console.log('featured job package order: smoke ok');
