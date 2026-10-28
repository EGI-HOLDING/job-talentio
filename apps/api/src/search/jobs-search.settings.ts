/**
 * Meilisearch jobs index settings.
 * oneTypo at 4 (Meili default is 5) so 4-letter role tokens like "data" /
 * "java" still correct a single transposition. twoTypos stays at the default 9.
 */
export const JOBS_INDEX_SETTINGS = {
  searchableAttributes: [
    'title',
    'titleAlt',
    'jobTitle',
    'companyName',
    'skills',
    'categoryName',
    'cityName',
    'countryName',
    'description',
    'descriptionAlt',
  ],
  filterableAttributes: [
    'id',
    'exposureVersion',
    'promotionEnabled',
    'boostProjectedActive',
    'boostEndsAt',
    'exposureUpdatedAt',
  ],
  sortableAttributes: ['exposureLog', 'publishedAt', 'id'],
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attribute',
    'exactness',
    'exposureLog:desc',
    'publishedAt:desc',
    'id:asc',
  ],
  pagination: { maxTotalHits: 1000000 },
  displayedAttributes: ['id'],
  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 4,
      twoTypos: 9,
    },
  },
} as const;
