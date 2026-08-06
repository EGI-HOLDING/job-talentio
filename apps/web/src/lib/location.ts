import { formatJobLocation } from '@job-talentio/shared';

export { formatJobLocation };

/** Convenience wrapper when city is a plain string from older payloads */
export function jobLocationLabel(job: {
  workMode?: string | null;
  city?: { name: string } | string | null;
}): string {
  const city =
    typeof job.city === 'string'
      ? { name: job.city }
      : job.city
        ? { name: job.city.name }
        : null;
  return formatJobLocation({ workMode: job.workMode, city });
}
