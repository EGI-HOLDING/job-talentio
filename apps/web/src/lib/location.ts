import { formatJobLocation } from '@job-talentio/shared';

export { formatJobLocation };

type JobLocationInput = {
  workMode?: string | null;
  city?: { name: string } | string | null;
};

function cityName(job: JobLocationInput): string | null {
  if (typeof job.city === 'string') return job.city.trim() || null;
  return job.city?.name?.trim() || null;
}

/** Convenience wrapper when city is a plain string from older payloads */
export function jobLocationLabel(job: JobLocationInput): string {
  const city = cityName(job);
  return formatJobLocation({ workMode: job.workMode, city: city ? { name: city } : null });
}

/**
 * Localized variant of `jobLocationLabel`. Work-mode words come from the enum
 * dictionary; the city name itself stays as stored until catalog translations
 * land. Pass the `t` function from `useI18n()`.
 */
export function localizedJobLocation(
  job: JobLocationInput,
  t: (key: string) => string,
): string {
  const city = cityName(job);
  switch (job.workMode) {
    case 'REMOTE': {
      const remote = t('enum.workMode.location.REMOTE');
      return city ? `${remote}, ${city}` : remote;
    }
    case 'HYBRID': {
      const hybrid = t('enum.workMode.location.HYBRID');
      return city ? `${city}, ${hybrid}` : hybrid;
    }
    default:
      return city || t('enum.workMode.location.UNKNOWN');
  }
}
