/** Display location for job cards — workMode is the source of truth for remote. */
export function formatJobLocation(job: {
  workMode?: string | null;
  city?: { name: string } | null;
}): string {
  const city = job.city?.name?.trim();
  switch (job.workMode) {
    case 'REMOTE':
      // Optional city = hiring region / timezone hub, not an office address
      return city ? `Remote · ${city}` : 'Remote';
    case 'HYBRID':
      return city ? `${city} · Hybrid` : 'Hybrid';
    case 'ONSITE':
    default:
      return city || 'Location TBD';
  }
}

export function isRemoteWorkMode(workMode?: string | null): boolean {
  return workMode === 'REMOTE';
}
