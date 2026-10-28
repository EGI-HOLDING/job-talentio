import { jobKeywordOr, shouldTrustMeiliIds } from './job-keyword';
import { toJobSearchDocument } from './jobs-index.sync';
import { JOBS_INDEX_SETTINGS } from './jobs-search.settings';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deadOrEmptyMeiliIdsAreNotAFilter() {
  assert(!shouldTrustMeiliIds(null, 0), 'disabled Meili must fall back');
  assert(!shouldTrustMeiliIds(null, 4), 'a Meili miss must fall back even if other jobs exist');
  assert(!shouldTrustMeiliIds([], 0), 'an empty id list must not become id IN ()');
  assert(!shouldTrustMeiliIds(['stale-id'], 0), 'ids that are no longer published must fall back');
  assert(shouldTrustMeiliIds(['live-id'], 1), 'a live published id is a trustworthy filter');
}

function keywordSearchIncludesCatalogTitle() {
  const clause = JSON.stringify(jobKeywordOr('Sales'));
  assert(clause.includes('jobTitle'), 'keyword search must look at the catalog title');
  assert(clause.includes('nameUz'), 'keyword search must look at translated catalog names');
  assert(clause.includes('aliases'), 'keyword search must include role/city aliases');
  assert(clause.includes('country'), 'keyword search must include country-only remote jobs');
  assert(clause.includes('"isAnonymous":false'), 'company keyword matching must exclude confidential postings');
  assert(
    (JOBS_INDEX_SETTINGS.searchableAttributes as readonly string[]).includes('jobTitle'),
    'Meili must index the catalog title',
  );
}

function documentCarriesCatalogTitle() {
  const doc = toJobSearchDocument({
    id: 'job-1',
    isAnonymous: false,
    title: 'Sales Manager',
    description: 'B2B sales',
    publishedAt: null,
    company: { name: 'UzPay' },
    city: null,
    category: null,
    country: { name: 'Indonesia', nameId: 'Indonesia' },
    jobTitle: { name: 'Sales Manager', nameUz: 'Savdo menejeri', nameRu: null, aliases: [{ alias: 'Sales Lead' }] },
    jobSkills: [],
    translations: [],
  });
  assert(doc.title === 'Sales Manager', 'posting title stays searchable');
  const confidential = toJobSearchDocument({
    id: 'private-job', isAnonymous: true, title: 'Engineer', description: 'Private employer',
    publishedAt: null, company: { name: 'Secret Employer' }, city: null, category: null,
    jobTitle: null, jobSkills: [], translations: [],
  });
  assert(confidential.companyName === '', 'confidential employer must not enter the search index');
  assert(
    doc.jobTitle === 'Sales Manager Savdo menejeri Sales Lead',
    `catalog title missing from the index document: ${doc.jobTitle}`,
  );
  assert(doc.countryName === 'Indonesia Indonesia', 'country must be indexed even without a city');
}

deadOrEmptyMeiliIdsAreNotAFilter();
keywordSearchIncludesCatalogTitle();
documentCarriesCatalogTitle();
console.log('api: jobs-search smoke ok');
