import { JOBS_INDEX_SETTINGS } from './jobs-search.settings';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function typoThresholdAllowsFourLetterRoles() {
  const { oneTypo, twoTypos } = JOBS_INDEX_SETTINGS.typoTolerance.minWordSizeForTypos;
  assert(oneTypo === 4, `oneTypo must be 4 so "dtaa" can match "data", got ${oneTypo}`);
  assert(twoTypos === 9, `twoTypos must stay at Meili default 9, got ${twoTypos}`);
  assert(JOBS_INDEX_SETTINGS.typoTolerance.enabled, 'typo tolerance must stay on');
}

typoThresholdAllowsFourLetterRoles();
console.log('api: jobs-search.settings smoke ok');
