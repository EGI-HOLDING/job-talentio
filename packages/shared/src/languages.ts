export const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'] as const;

export type LanguageLevelCode = (typeof LANGUAGE_LEVELS)[number];

export type LanguageFilterToken = {
  code: string;
  minLevel: LanguageLevelCode;
};

const LEVEL_RANK: Record<LanguageLevelCode, number> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
  NATIVE: 7,
};

export function languageLevelRank(level: string | null | undefined): number {
  if (!level) return 0;
  const key = level.toUpperCase() as LanguageLevelCode;
  return LEVEL_RANK[key] ?? 0;
}

export function isLanguageLevel(value: string): value is LanguageLevelCode {
  return (LANGUAGE_LEVELS as readonly string[]).includes(value.toUpperCase());
}

/** Levels at or above the given floor (inclusive), for Prisma `in` filters. */
export function levelsAtOrAbove(minLevel: string): LanguageLevelCode[] {
  const floor = languageLevelRank(minLevel) || 1;
  return LANGUAGE_LEVELS.filter((l) => LEVEL_RANK[l] >= floor);
}

/**
 * Parse `languages=en:B2,ru` — bare code means A1+ (any proficiency).
 * Invalid level suffixes are ignored (token treated as bare code → A1).
 */
export function parseLanguagesCsv(csv: string | null | undefined): LanguageFilterToken[] {
  if (!csv?.trim()) return [];
  const seen = new Set<string>();
  const out: LanguageFilterToken[] = [];
  for (const part of csv.split(',')) {
    const raw = part.trim();
    if (!raw) continue;
    const colon = raw.indexOf(':');
    let code = raw;
    let minLevel: LanguageLevelCode = 'A1';
    if (colon > 0) {
      code = raw.slice(0, colon).trim();
      const levelRaw = raw.slice(colon + 1).trim().toUpperCase();
      if (isLanguageLevel(levelRaw)) minLevel = levelRaw;
    }
    code = code.toLowerCase();
    if (!/^[a-z]{2,8}$/.test(code)) continue;
    const key = `${code}:${minLevel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code, minLevel });
  }
  return out;
}

export function languageTokenKey(code: string): string {
  return code.toLowerCase().split(':')[0] || code.toLowerCase();
}

/** Whether a CSV already contains this language code (any level). */
export function csvHasLanguageCode(csv: string, code: string): boolean {
  const target = code.toLowerCase();
  return parseLanguagesCsv(csv).some((t) => t.code === target);
}
