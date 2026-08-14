/**
 * Meilisearch jobs index settings.
 * oneTypo at 4 (Meili default is 5) so 4-letter role tokens like "data" /
 * "java" still correct a single transposition. twoTypos stays at the default 9.
 */
export const JOBS_INDEX_SETTINGS = {
  searchableAttributes: [
    'title',
    'titleAlt',
    'companyName',
    'skills',
    'categoryName',
    'cityName',
    'description',
    'descriptionAlt',
  ],
  displayedAttributes: ['id'],
  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 4,
      twoTypos: 9,
    },
  },
} as const;
