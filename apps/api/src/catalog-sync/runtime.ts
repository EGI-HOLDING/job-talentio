/** Database-owned catalogs must survive container restarts byte-for-byte. */
export function databaseCatalogs(env = process.env): boolean {
  const mode = env.CATALOG_SOURCE_MODE;
  if (mode && !['legacy', 'database'].includes(mode)) throw new Error('Invalid CATALOG_SOURCE_MODE');
  return mode === 'database';
}

export function catalogMaintenance(env = process.env): boolean {
  return env.CATALOG_SYNC_MAINTENANCE === 'true';
}
