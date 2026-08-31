import {
  extractEmail,
  extractPhone,
  normalizeSkillNames,
  parseCvText,
  stripNullBytesDeep,
  type ParsedCvData,
  type ParsedEducation,
  type ParsedExperience,
  type ParsedLanguage,
} from '../cv-parser';
import { rejoinWrappedCvLines } from './cv-line-rejoin';

const DEGREE_SET = new Set<ParsedEducation['degree']>([
  'HIGH_SCHOOL',
  'VOCATIONAL',
  'BACHELOR',
  'MASTER',
  'PHD',
]);

const LEVEL_SET = new Set<ParsedLanguage['level']>([
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
  'NATIVE',
]);

const MIN_LLM_TEXT_CHARS = 200;

export function isCvTextRichEnoughForLlm(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim().length >= MIN_LLM_TEXT_CHARS;
}

const EXPERIENCE_DESCRIPTION_MAX = 5000;

/** Keep prompt cost low: head + tail of long CVs. Rejoin wraps first. */
export function truncateCvTextForLlm(text: string, maxChars = 12_000): string {
  const cleaned = rejoinWrappedCvLines(text);
  if (cleaned.length <= maxChars) return cleaned;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head - 32;
  return `${cleaned.slice(0, head)}\n\n[...truncated...]\n\n${cleaned.slice(-tail)}`;
}

function asString(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

/** Keep bullet line breaks; collapse only spaces/tabs on a line. */
function asMultilineString(value: unknown, max = EXPERIENCE_DESCRIPTION_MAX): string | undefined {
  const raw = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string').join('\n')
    : value;
  if (typeof raw !== 'string') return undefined;
  const s = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

function asDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  return undefined;
}

function normalizeExperiences(raw: unknown): ParsedExperience[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedExperience[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title = asString(row.title, 120);
    const companyName = asString(row.companyName, 120);
    if (!title && !companyName) continue;
    out.push({
      title: title || 'Role',
      companyName: companyName || 'Company',
      startDate: asDate(row.startDate) ?? null,
      endDate: asDate(row.endDate) ?? null,
      isCurrent: Boolean(row.isCurrent),
      description: asMultilineString(row.description, EXPERIENCE_DESCRIPTION_MAX),
    });
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeEducations(raw: unknown): ParsedEducation[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedEducation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const school = asString(row.school, 160);
    if (!school) continue;
    const degreeRaw = asString(row.degree, 32)?.toUpperCase();
    const degree =
      degreeRaw && DEGREE_SET.has(degreeRaw as ParsedEducation['degree'])
        ? (degreeRaw as ParsedEducation['degree'])
        : undefined;
    out.push({
      school,
      degree,
      field: asString(row.field, 120),
      startDate: asDate(row.startDate) ?? null,
      endDate: asDate(row.endDate) ?? null,
    });
    if (out.length >= 8) break;
  }
  return out;
}

function normalizeLanguages(raw: unknown): ParsedLanguage[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedLanguage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = asString(row.name, 60);
    if (!name) continue;
    const levelRaw = asString(row.level, 16)?.toUpperCase();
    const level =
      levelRaw && LEVEL_SET.has(levelRaw as ParsedLanguage['level'])
        ? (levelRaw as ParsedLanguage['level'])
        : 'B1';
    out.push({
      name,
      code: asString(row.code, 8)?.toLowerCase(),
      level,
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** Validate LLM JSON into ParsedCvData; overlay regex email/phone when missing. */
export function normalizeLlmCvPayload(
  payload: unknown,
  opts: {
    sourceText: string;
    knownSkills: Array<{ name: string; slug: string }>;
    ocrUsed: boolean;
  },
): ParsedCvData {
  const row =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

  const skillRaw = Array.isArray(row.skillNames)
    ? row.skillNames.filter((s): s is string => typeof s === 'string')
    : [];

  const localContact = parseCvText(opts.sourceText, []);
  const email = asString(row.email, 120)?.toLowerCase() || extractEmail(opts.sourceText) || localContact.email;
  const phone = asString(row.phone, 40) || extractPhone(opts.sourceText) || localContact.phone;

  const previewSource = opts.sourceText.replace(/\s+/g, ' ').trim();

  return stripNullBytesDeep({
    email,
    phone,
    headline: asString(row.headline, 120),
    summary: asString(row.summary, 1000),
    skillNames: normalizeSkillNames(skillRaw, opts.knownSkills),
    experiences: normalizeExperiences(row.experiences),
    educations: normalizeEducations(row.educations),
    languages: normalizeLanguages(row.languages),
    textPreview: previewSource.slice(0, 2000),
    meta: { provider: 'llm', ocrUsed: opts.ocrUsed, llmUsed: true },
  });
}

export const LLM_CV_SYSTEM_PROMPT = `You extract structured resume/CV data. Return ONLY a JSON object with keys:
email (string|null), phone (string|null), headline (string|null), summary (string|null),
skillNames (string[]), experiences (array of {title, companyName, startDate, endDate, isCurrent, description}),
educations (array of {school, degree, field, startDate, endDate}),
languages (array of {name, code, level}).
Dates ISO YYYY-MM-DD or null. degree one of HIGH_SCHOOL|VOCATIONAL|BACHELOR|MASTER|PHD or null.
level one of A1|A2|B1|B2|C1|C2|NATIVE. Omit invented facts; use null/[] when unknown.
For each role, put every job-duty line in description. Do not summarize or omit bullets.
PDF line wraps without a bullet belong to the previous sentence; join them.
description is one string with a newline between bullets.
Never put the next role's title, company, or dates inside the previous description; start a new experiences item instead.`;
