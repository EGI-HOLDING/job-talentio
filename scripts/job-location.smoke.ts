import assert from 'node:assert/strict';
import { buildJobPostingJsonLd, type JobSeoPayload } from '../apps/web/src/lib/jobSeo';
import { localizedJobLocation } from '../apps/web/src/lib/location';
import { formatJobLocation } from '../packages/shared/src/location';

const job: JobSeoPayload = {
  id: 'location-test', title: 'Engineer', description: 'Local test', employmentType: 'FULL_TIME',
  workMode: 'REMOTE', salaryPeriod: 'MONTHLY', currency: 'USD', createdAt: '2026-10-24',
  company: { name: 'Test company', slug: 'test-company' }, country: { name: 'Indonesia', iso2: 'ID' },
};
const remote = buildJobPostingJsonLd(job, 'id');
assert.deepEqual(remote.applicantLocationRequirements, { '@type': 'Country', name: 'Indonesia' });
assert.equal(remote.jobLocationType, 'TELECOMMUTE');
const global = buildJobPostingJsonLd({ ...job, country: null });
assert.equal(global.applicantLocationRequirements, undefined, 'Worldwide remote must not imply Uzbekistan');
const onsite: any = buildJobPostingJsonLd({ ...job, country: null, workMode: 'ONSITE', city: { name: 'Jakarta', province: { name: 'DKI Jakarta', country: job.country! } } });
assert.equal(onsite.jobLocation.address.addressCountry, 'ID');
assert.equal(onsite.jobLocation.address.addressLocality, 'Jakarta');
assert.equal(formatJobLocation(job), 'Remote · Indonesia');
assert.equal(localizedJobLocation(job, () => 'Remote'), 'Remote, Indonesia');
console.log('PASS: country-aware structured data, global remote, legacy city hierarchy and location labels');
