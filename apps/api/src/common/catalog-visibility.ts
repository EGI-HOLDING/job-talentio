/**
 * Archived catalog rows disappear from anywhere a user picks or browses a term,
 * but stay attached to the profiles and postings that already reference them.
 * Removing them from existing records would look like data loss to the owner.
 *
 * Apply `ACTIVE_CATALOG` to lists, suggestions and slug lookups for new input.
 * Do not apply it to relation includes on detail payloads, to admin queries, or
 * to backfills.
 */
export const ACTIVE_CATALOG = { archivedAt: null } as const;

/**
 * Why the resolve helpers deliberately still match archived rows:
 *
 * `normalizedKey` and `slug` are unique. If `resolveSkill` ignored an archived
 * row it would try to create a second row with the same key and hit the
 * constraint, so a recruiter typing an archived term free-hand would get an
 * error instead of a posting. Reusing the archived row is the only option that
 * works, and it is harmless: archiving stops a term being *offered*, it does
 * not forbid every mention of it. The term still will not appear in any
 * suggestion list or facet.
 */

/** Spread into an existing `where` without repeating the shape. */
export function activeCatalog<T extends Record<string, unknown>>(where?: T) {
  return { ...(where ?? ({} as T)), archivedAt: null };
}

/** True when a row can still be offered for new selections. */
export function isActiveCatalogRow(row: { archivedAt?: Date | null } | null | undefined): boolean {
  return Boolean(row) && !row?.archivedAt;
}
