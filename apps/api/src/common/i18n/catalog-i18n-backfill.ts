import type { PrismaClient } from '@prisma/client';
export type CatalogI18nResult = Record<string, { updated: number; skipped: number; missing: number }>;
/** Legacy command retained for compatibility. Geographic translations live in the database. */
export async function backfillCatalogI18n(_db: PrismaClient): Promise<CatalogI18nResult> { return {}; }
