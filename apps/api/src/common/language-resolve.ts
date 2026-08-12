import { BadRequestException } from '@nestjs/common';
import { Language, PrismaClient } from '@prisma/client';
import {
  assertCatalogLabel,
  normalizeLookupKey,
  titleCaseWords,
} from './lookup-normalize';

type Db = Pick<PrismaClient, 'language' | 'languageAlias'>;

const LANGUAGE_SYNONYMS: Record<string, string> = {
  uzbek: 'uz',
  ozbek: 'uz',
  ozbekcha: 'uz',
  russian: 'ru',
  russkiy: 'ru',
  english: 'en',
  eng: 'en',
  kazakh: 'kk',
  turkish: 'tr',
  german: 'de',
  deutsch: 'de',
  french: 'fr',
  korean: 'ko',
  chinese: 'zh',
  mandarin: 'zh',
  arabic: 'ar',
};

export function languageKey(input: string): string {
  const raw = input.trim().toLowerCase();
  if (/^[a-z]{2,3}$/.test(raw)) return LANGUAGE_SYNONYMS[raw] ?? raw;
  const key = normalizeLookupKey(input);
  return LANGUAGE_SYNONYMS[key] ?? key;
}

function codeFromInput(input: string): string {
  const k = languageKey(input);
  if (/^[a-z]{2,3}$/.test(k)) return k;
  return k.slice(0, 3);
}

export type ResolveLanguageResult = {
  language: Language;
  created: boolean;
  matchedVia: 'code' | 'normalizedKey' | 'alias' | 'name' | 'created';
};

export async function resolveLanguage(
  db: Db,
  opts: { name?: string; code?: string; allowCreate?: boolean },
): Promise<ResolveLanguageResult> {
  const allowCreate = opts.allowCreate !== false;
  const raw = (opts.name || opts.code || '').trim();
  if (!raw) throw new BadRequestException('code or name required');

  const code = (opts.code || codeFromInput(raw)).toLowerCase().slice(0, 8);
  const key = languageKey(raw);

  const byCode = await db.language.findUnique({ where: { code } });
  if (byCode) {
    await ensureAlias(db, byCode.id, raw, key);
    return { language: byCode, created: false, matchedVia: 'code' };
  }

  if (key) {
    const byKey = await db.language.findUnique({ where: { normalizedKey: key } });
    if (byKey) {
      await ensureAlias(db, byKey.id, raw, key);
      return { language: byKey, created: false, matchedVia: 'normalizedKey' };
    }

    const byAlias = await db.languageAlias.findUnique({
      where: { aliasKey: key },
      include: { language: true },
    });
    if (byAlias?.language) {
      return { language: byAlias.language, created: false, matchedVia: 'alias' };
    }
  }

  const byName = await db.language.findFirst({
    where: { name: { equals: raw, mode: 'insensitive' } },
  });
  if (byName) {
    await ensureAlias(db, byName.id, raw, key);
    return { language: byName, created: false, matchedVia: 'name' };
  }

  if (!allowCreate) throw new BadRequestException('Language not found');

  try {
    assertCatalogLabel(opts.name || raw);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }

  const displayName = opts.name?.trim() || titleCaseWords(raw);
  const finalCode = code || codeFromInput(displayName);

  try {
    // Language names always read differently per locale ("Kazakh" / "Qozoqcha" /
    // "Казахский"), so they never qualify as a tech identity.
    const language = await db.language.create({
      data: {
        name: displayName,
        code: finalCode,
        normalizedKey: key || finalCode,
        i18nStatus: 'PENDING',
      },
    });
    return { language, created: true, matchedVia: 'created' };
  } catch {
    const again = await db.language.findUnique({ where: { code: finalCode } });
    if (again) {
      await ensureAlias(db, again.id, raw, key);
      return { language: again, created: false, matchedVia: 'code' };
    }
    throw new BadRequestException('Could not create language');
  }
}

async function ensureAlias(db: Db, languageId: string, alias: string, aliasKey: string) {
  if (!aliasKey) return;
  const language = await db.language.findUnique({ where: { id: languageId } });
  if (!language) return;
  if (languageKey(language.name) === aliasKey || language.code === aliasKey) return;
  const existing = await db.languageAlias.findUnique({ where: { aliasKey } });
  if (existing) return;
  await db.languageAlias
    .create({ data: { languageId, alias: alias.trim().slice(0, 80), aliasKey } })
    .catch(() => undefined);
}
