export type FeaturedCompanySeedTarget = 'local' | 'indonesia-vps';

export type ResolvedFeaturedCompanySeedTarget = {
  target: FeaturedCompanySeedTarget;
  database: 'job_talentio' | 'talentio';
};

/** Fail closed: the production target is only the dedicated VPS app role/database. */
export function assertFeaturedCompanySeedTarget(
  databaseUrl: string,
  targetValue: string,
): ResolvedFeaturedCompanySeedTarget {
  if (targetValue !== 'local' && targetValue !== 'indonesia-vps') {
    throw new Error('Seed target must be explicitly local or indonesia-vps');
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('Seed DATABASE_URL is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Seed accepts only a PostgreSQL DATABASE_URL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (targetValue === 'local') {
    if (url.hostname !== '127.0.0.1' || database !== 'job_talentio') {
      throw new Error('Refusing to run: local target must be 127.0.0.1 database job_talentio');
    }
    return { target: 'local', database: 'job_talentio' };
  }

  const query = [...url.searchParams.entries()];
  const safeSchemaQuery = query.length === 0 || (query.length === 1 && query[0][0] === 'schema' && query[0][1] === 'public');
  if (
    url.hostname !== 'host.docker.internal' ||
    (url.port || '5432') !== '5432' ||
    decodeURIComponent(url.username) !== 'talentio_app' ||
    database !== 'talentio' ||
    !safeSchemaQuery
  ) {
    throw new Error('Refusing to run: indonesia-vps target must use talentio_app on host.docker.internal:5432/talentio');
  }
  return { target: 'indonesia-vps', database: 'talentio' };
}
