import { normalizeSkillKey } from '../common/skill-resolve';
import {
  isCvBulletLine,
  isCvRoleBoundary,
  isCvTitleLikeHeading,
  rejoinWrappedCvLines,
} from './parse/cv-line-rejoin';

export type ParsedExperience = {
  title: string;
  companyName: string;
  startDate?: string | null;
  endDate?: string | null;
  isCurrent?: boolean;
  description?: string;
};

export type ParsedEducation = {
  school: string;
  degree?: 'HIGH_SCHOOL' | 'VOCATIONAL' | 'BACHELOR' | 'MASTER' | 'PHD';
  field?: string;
  startDate?: string | null;
  endDate?: string | null;
};

export type ParsedLanguage = {
  code?: string;
  name: string;
  level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'NATIVE';
};

export type ParsedCvMeta = {
  provider: string;
  ocrUsed?: boolean;
  /** Always false for new parses; retained for compatibility with stored results. */
  llmUsed?: boolean;
};

export type ParsedCvData = {
  email?: string;
  phone?: string;
  headline?: string;
  summary?: string;
  skillNames: string[];
  experiences: ParsedExperience[];
  educations: ParsedEducation[];
  languages: ParsedLanguage[];
  textPreview: string;
  /** Parser diagnostics; UI review should ignore. */
  meta?: ParsedCvMeta;
};
export type CvCatalogSkill = {
  name: string;
  slug: string;
  aliases?: Array<{ alias: string; aliasKey: string }>;
};

export type CvCatalogLanguage = {
  name: string;
  code: string;
  aliases?: Array<{ alias: string; aliasKey: string }>;
};

/** Unicode-aware token boundary (JS \\b is weak for Cyrillic). */
const BOUND_L = '(?:^|[^\\p{L}\\p{N}])';
const BOUND_R = '(?=[^\\p{L}\\p{N}]|$)';

const DEGREE_MAP: Array<{ re: RegExp; degree: ParsedEducation['degree'] }> = [
  {
    re: new RegExp(`${BOUND_L}(ph\\.?d|doctorate|doktor|доктор|аспирант)${BOUND_R}`, 'iu'),
    degree: 'PHD',
  },
  {
    re: new RegExp(`${BOUND_L}(master|m\\.?sc|mba|magistr|магистр)${BOUND_R}`, 'iu'),
    degree: 'MASTER',
  },
  {
    re: new RegExp(`${BOUND_L}(bachelor|b\\.?sc|b\\.?a|bakalavr|бакалавр)${BOUND_R}`, 'iu'),
    degree: 'BACHELOR',
  },
  {
    re: new RegExp(
      `${BOUND_L}(vocational|college|kollej|texnikum|колледж|техникум)${BOUND_R}`,
      'iu',
    ),
    degree: 'VOCATIONAL',
  },
  {
    re: new RegExp(
      `${BOUND_L}(high\\s*school|lyceum|litsey|maktab|лицей|школа)${BOUND_R}`,
      'iu',
    ),
    degree: 'HIGH_SCHOOL',
  },
];

const LANG_LEVEL =
  'native|mother\\s*tongue|ona\\s*tili|родн(?:ой|ая|ый)?(?:\\s*язык)?|c2|c1|b2|b1|a2|a1|fluent|advanced|intermediate|elementary|basic|beginner|свободно|родной';

const MONTHS_EN =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTHS_RU =
  'январ[ьяе]?|феврал[ьяе]?|март[ае]?|апрел[ьяе]?|ма[йяе]|июн[ьяе]?|июл[ьяе]?|август[ае]?|сентябр[ьяе]?|октябр[ьяе]?|ноябр[ьяе]?|декабр[ьяе]?';
const MONTHS_UZ =
  'yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr';
const MONTHS_ID = 'januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember';
const MONTHS = `${MONTHS_EN}|${MONTHS_RU}|${MONTHS_UZ}|${MONTHS_ID}`;

const CURRENT_END =
  'present|now|current|hozir|saat\\s+ini|sekarang|по\\s*настоящее\\s*время|настоящее\\s*время|по\\s*н\\.?\\s*в\\.?|н\\.?\\s*в\\.?';

function monthToNumber(monthHint?: string): string {
  if (!monthHint) return '01';
  const m = monthHint.trim().toLowerCase();
  const rules: Array<{ re: RegExp; mm: string }> = [
    { re: /^(jan|янв|yan)/u, mm: '01' },
    { re: /^(feb|фев|fev)/u, mm: '02' },
    { re: /^(mar|мар|mart)/u, mm: '03' },
    { re: /^(apr|апр|apr)/u, mm: '04' },
    { re: /^(may|mei|ма[йяе]?)/u, mm: '05' },
    { re: /^(jun|июн|iyun)/u, mm: '06' },
    { re: /^(jul|июл|iyul)/u, mm: '07' },
    { re: /^(aug|agu|авг|avg)/u, mm: '08' },
    { re: /^(sep|сен|sent)/u, mm: '09' },
    { re: /^(oct|окт|okt)/u, mm: '10' },
    { re: /^(nov|ноя|noy)/u, mm: '11' },
    { re: /^(dec|des|дек|dek)/u, mm: '12' },
  ];
  for (const r of rules) {
    if (r.re.test(m)) return r.mm;
  }
  return '01';
}

function toIsoDate(year: string, monthHint?: string): string {
  return `${year}-${monthToNumber(monthHint)}-01`;
}

function isCurrentEnd(raw: string): boolean {
  return new RegExp(`^(?:${CURRENT_END})$`, 'iu').test(raw.trim());
}

export function extractEmail(text: string): string | undefined {
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m?.[0]?.toLowerCase();
}

export function normalizeCvPhone(raw: string): string | undefined {
  if(!/^[+\d\s().-]+$/.test(raw.trim())) return undefined;
  const value=raw.replace(/[^\d+]/g,'');
  const normalized=value.startsWith('00')?'+'+value.slice(2):value;
  if(!/^\+?\d{9,15}$/.test(normalized))return undefined;
  return normalized;
}
export function extractPhone(text: string): string | undefined {
  const candidates=text.matchAll(/(?<![\p{L}\p{N}])\+?\d[\d ()\t.-]{6,}\d(?![\p{L}\p{N}])/gu);
  for(const match of candidates){
    // Dates and year ranges are never contact numbers. Do not join lines.
    if(/(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}/.test(match[0]))continue;
    const phone=normalizeCvPhone(match[0]);if(phone)return phone;
  }
  return undefined;
}

type CvSection = 'experience' | 'education' | 'skills' | 'summary' | 'languages';

/** Heading at the start of a line. The rest of the line, after a colon, is section content. */
const SECTION_RES: Array<{ kind: CvSection; re: RegExp }> = [
  {
    kind: 'experience',
    re: /^(?:pengalaman(?:\s+kerja)?|work\s+experience|professional\s+experience|employment(?:\s+history)?|work\s+history|experience|опыт(?:\s+работы)?|ish\s+tajriba(?:si)?|mehnat\s+faoliyati)(?=\s|[:–—-]|$)/iu,
  },
  {
    kind: 'education',
    re: /^(?:pendidikan|academic(?:\s+background)?|education|образование|ta['’ʻ`]?lim)(?=\s|[:–—-]|$)/iu,
  },
  {
    kind: 'skills',
    re: /^(?:keahlian|keterampilan|technical\s+skills|key\s+skills|skills|навыки|ko['’ʻ`]?nikmalar?)(?=\s|[:–—-]|$)/iu,
  },
  {
    kind: 'languages',
    re: /^(?:bahasa|languages|языки|tillar)(?=\s|[:–—-]|$)/iu,
  },
  {
    kind: 'summary',
    re: /^(?:ringkasan|tentang\s+saya|professional\s+summary|summary|about\s+me|objective|о\s+себе|обо\s+мне|men\s+haqimda|maqsad)(?=\s|[:–—-]|$)/iu,
  },
];

function matchSectionHeading(line: string): { kind: CvSection; rest: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return null;
  for (const { kind, re } of SECTION_RES) {
    if (!re.test(trimmed)) continue;
    const rest = trimmed.replace(re, '').replace(/^[\s:–—-]+/, '').trim();
    return { kind, rest };
  }
  return null;
}

function splitCvSections(text: string): Partial<Record<CvSection, string>> {
  const buckets: Partial<Record<CvSection, string[]>> = {};
  let current: CvSection | null = null;
  for (const raw of text.split(/\n/)) {
    const heading = matchSectionHeading(raw);
    if (heading) {
      current = heading.kind;
      if (heading.rest) (buckets[current] ??= []).push(heading.rest);
      continue;
    }
    if (current) (buckets[current] ??= []).push(raw);
  }
  const out: Partial<Record<CvSection, string>> = {};
  for (const kind of Object.keys(buckets) as CvSection[]) {
    const body = (buckets[kind] || []).join('\n').trim();
    if (body) out[kind] = body;
  }
  return out;
}

function skillMentioned(haystack: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${BOUND_L}${escaped}${BOUND_R}`, 'iu');
  return re.test(haystack);
}

function escapeRegexLabel(input: string): string {
  return input.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

function labelPattern(input: string): string {
  return input.trim().split(/\s+/).map(escapeRegexLabel).join('\\s+');
}

function extractSkills(text: string, knownSkills: CvCatalogSkill[], allowShort: boolean): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const skill of knownSkills) {
    const labels = [skill.name, ...(skill.aliases ?? []).map((alias) => alias.alias)];
    const matched = labels.some((label) => {
      const pattern = labelPattern(label);
      if (!pattern || (!allowShort && label.trim().length < 4)) return false;
      const re = new RegExp(BOUND_L + pattern + BOUND_R, 'iu');
      return re.test(lower);
    });
    if (matched) found.push(skill.name);
  }
  return Array.from(new Set(found)).slice(0, 40);
}

/**
 * Map extracted skill labels onto catalog names when possible;
 * keep unmatched labels (trimmed) so review/import can still create skills.
 */
export function normalizeSkillNames(
  rawNames: string[],
  knownSkills: CvCatalogSkill[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawNames) {
    const label = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (!label) continue;
    const key = normalizeSkillKey(label);
    const catalog = knownSkills.find(
      (skill) =>
        skill.name.toLowerCase() === label.toLowerCase() ||
        skill.slug.toLowerCase() === label.toLowerCase().replace(/[^a-z0-9]+/g, '-') ||
        skill.aliases?.some((alias) => alias.aliasKey === key),
    );
    const name = catalog?.name || label;
    const normalizedName = name.toLowerCase();
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    out.push(name);
    if (out.length >= 40) break;
  }
  return out;
}
function extractLanguages(text: string, knownLanguages: CvCatalogLanguage[]): ParsedLanguage[] {
  const out: ParsedLanguage[] = [];
  const hints = knownLanguages
    .map((language) => ({
      ...language,
      labels: [language.name, ...(language.aliases ?? []).map((alias) => alias.alias)]
        .map((label) => label.trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length),
    }))
    .sort((a, b) => {
      const longest = (labels: string[]) => Math.max(0, ...labels.map((label) => label.length));
      return longest(b.labels) - longest(a.labels);
    });

  for (const hint of hints) {
    const pattern = hint.labels.map(escapeRegexLabel).join('|');
    if (!pattern || out.some((language) => language.code === hint.code)) continue;
    const re = new RegExp(
      BOUND_L + '(' + pattern + ')' + BOUND_R + '\\s*[:\\-–—]?\\s*(' + LANG_LEVEL + ')?',
      'iu',
    );
    const match = text.match(re);
    if (!match) continue;
    let level: ParsedLanguage['level'];
    const rawLevel = (match[2] || '').toLowerCase();
    if (/native|mother|ona|родн/.test(rawLevel)) level = 'NATIVE';
    else if (rawLevel === 'c2' || rawLevel === 'fluent' || /свободн/.test(rawLevel)) level = 'C2';
    else if (rawLevel === 'c1' || rawLevel === 'advanced') level = 'C1';
    else if (rawLevel === 'b2') level = 'B2';
    else if (rawLevel === 'b1' || rawLevel === 'intermediate') level = 'B1';
    else if (rawLevel === 'a2' || rawLevel === 'elementary') level = 'A2';
    else if (rawLevel === 'a1' || rawLevel === 'basic' || rawLevel === 'beginner') level = 'A1';
    out.push({ name: hint.name, code: hint.code, level });
  }
  return out;
}
function extractExperiences(text: string, inWorkSection = false): ParsedExperience[] {
  const experiences: ParsedExperience[] = [];
  const dateRe = new RegExp(
    `((?:${MONTHS})\\s+)?(20\\d{2}|19\\d{2})\\s*(?:[-–—]|to|sampai|hingga|до)\\s*((?:${MONTHS})\\s+)?(20\\d{2}|19\\d{2}|${CURRENT_END})`,
    'giu',
  );
  // Institution/degree cues only — bare section headers like "Education" / "Образование"
  // often follow a job date line and must not suppress experience extraction.
  const eduHint = new RegExp(
    `${BOUND_L}(university|universitet|университет|institute|institut|институт|college|kollej|колледж|academy|академия|akademiya|bachelor|bakalavr|бакалавр|master|magistr|магистр|ph\\.?d|доктор|аспирант)${BOUND_R}`,
    'iu',
  );

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const chunks =
    lines.length > 1
      ? lines
      : text.split(/(?<=[.!?])\s+|\s{2,}|[•●▪]/).map((l) => l.trim()).filter((l) => l.length > 3);

  for (let i = 0; i < chunks.length; i++) {
    const line = chunks[i];
    dateRe.lastIndex = 0;
    const dm = dateRe.exec(line);
    if (!dm) continue;

    const prev = chunks[i - 1] || '';
    const next = chunks[i + 1] || '';
    // Skip date ranges that belong to education blocks
    if (!inWorkSection && (eduHint.test(line) || eduHint.test(prev) || eduHint.test(next))) continue;

    const startDate = toIsoDate(dm[2], dm[1]?.trim());
    const endRaw = dm[4] || '';
    const isCurrent = isCurrentEnd(endRaw);
    const endDate = isCurrent ? null : toIsoDate(endRaw, dm[3]?.trim());

    let title = '';
    let companyName = '';

    const beforeDate = line
      .slice(0, dm.index)
      .replace(/[|,\-–—]\s*$/u, '')
      .trim();
    const atMatch = (beforeDate || prev).match(
      /^(.{3,80}?)\s+(?:at|@|\||–|-|,|в|в\s+компании)\s+(.{2,80})$/iu,
    );
    const usable = (value: string) =>
      value.length >= 2 &&
      !isCvBulletLine(value) &&
      !matchSectionHeading(value) &&
      (inWorkSection || !eduHint.test(value));

    if (atMatch && usable(atMatch[1]) && usable(atMatch[2])) {
      title = atMatch[1].trim();
      companyName = atMatch[2].trim();
    } else if (beforeDate && usable(beforeDate)) {
      companyName = beforeDate;
      if (usable(prev) && isCvTitleLikeHeading(prev)) title = prev;
      else if (usable(next) && isCvTitleLikeHeading(next)) title = next;
    } else {
      const preceding = chunks[i - 2] || '';
      // Common vertical layouts place both role and employer before the dates.
      if (usable(prev) && usable(preceding) && isCvTitleLikeHeading(prev) && isCvTitleLikeHeading(preceding)) {
        const prevIsRole = Boolean(extractHeadline(prev));
        const precedingIsRole = Boolean(extractHeadline(preceding));
        if (prevIsRole && !precedingIsRole) { title = prev; companyName = preceding; }
        else { title = preceding; companyName = prev; }
      } else if (usable(prev) && isCvTitleLikeHeading(prev)) title = prev;
      if (
        !companyName &&
        next &&
        usable(next) &&
        isCvTitleLikeHeading(next) &&
        next !== title
      ) {
        companyName = next;
      }
    }

    title = title.trim();
    companyName = companyName.trim();
    if (!title && !companyName) continue;

    const descParts: string[] = [];
    let j = i + 1;
    if (companyName && chunks[j] === companyName) j += 1;
    if (title && chunks[j] === title) j += 1;
    while (j < chunks.length) {
      const block = chunks[j];
      dateRe.lastIndex = 0;
      if (dateRe.test(block) || (isCvRoleBoundary(block) && !isCvBulletLine(block))) break;
      descParts.push(block);
      j += 1;
    }

    experiences.push({
      title: title.slice(0, 160),
      companyName: companyName.slice(0, 160),
      startDate,
      endDate,
      isCurrent,
      description: descParts.length ? descParts.join('\n').slice(0, 5000) : undefined,
    });
  }

  return experiences.slice(0, 12);
}

function extractEducations(text: string): ParsedEducation[] {
  const educations: ParsedEducation[] = [];
  const schoolRe = /university|universitet|университет|institute|institut|институт|college|kollej|колледж|academy|академия|akademiya|universitas|politeknik|sekolah/iu;
  const chunks = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  for (let i = 0; i < chunks.length; i++) {
    const school = chunks[i];
    if (!schoolRe.test(school)) continue;
    const details: string[] = [];
    while (i + 1 < chunks.length && details.length < 3 && !schoolRe.test(chunks[i + 1])) details.push(chunks[++i]);
    const block = [school, ...details].join(' ');
    const degree = DEGREE_MAP.find(item => item.re.test(block))?.degree;
    const years = block.match(/\b(?:19|20)\d{2}\b/g) || [];
    educations.push({ school: school.slice(0, 200), degree, field: details.join(' ').slice(0, 160) || undefined,
      startDate: years[0] ? years[0] + '-01-01' : null, endDate: years[1] ? years[1] + '-01-01' : null });
  }
  return educations.slice(0, 8);
}

function extractHeadline(text: string): string | undefined {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 5 && l.length < 120 && !l.includes('@') && !/\d{4}/.test(l));
  // Skip likely name (first short line), take next professional-looking line
  const candidates = lines.slice(0, 8);
  const roleLike = candidates.find((l) =>
    new RegExp(
      `${BOUND_L}(engineer|developer|designer|manager|analyst|specialist|lead|architect|consultant|backend|frontend|full[- ]?stack|разработчик|инженер|менеджер|аналитик|дизайнер|dasturchi|muhandis|menejer)${BOUND_R}`,
      'iu',
    ).test(l),
  );
  return roleLike?.slice(0, 120);
}

function extractSummary(text: string, explicitSection = false): string | undefined {
  const about = text.match(
    new RegExp(
      `(?:summary|profile|about\\s+me|objective|professional\\s+summary|о\\s+себе|обо\\s+мне|цель|резюме|men\\s+haqimda|maqsad|profil)\\s*[:\\n-]+\\s*([\\s\\S]{40,600}?)(?=\\n\\s*(?:experience|education|skills|work|employment|опыт(?:\\s*работы)?|образование|навыки|ish\\s+tajribasi|ta'?lim|ko'?nikmalar)\\b|$)`,
      'iu',
    ),
  );
  if (about?.[1]) return about[1].replace(/\s+/g, ' ').trim().slice(0, 1000);
  // Fallback: first substantial paragraph
  if (!explicitSection) return undefined;
  const para = text.replace(/\s+/g, ' ').trim().slice(0, 400);
  return para.length > 80 ? para : undefined;
}

/** Postgres rejects UTF-8 null bytes (0x00) in text/json columns. */
export function stripNullBytes(input: string): string {
  return input.replace(/\u0000/g, '');
}

export function stripNullBytesDeep<T>(value: T): T {
  if (typeof value === 'string') return stripNullBytes(value) as T;
  if (Array.isArray(value)) return value.map((v) => stripNullBytesDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripNullBytesDeep(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Local heuristic CV parser (no external ML).
 * Pass catalog names and aliases from DB so parsing follows the admin-managed lists.
 * Section and date heuristics support English, Russian (Cyrillic), and Uzbek Latin text.
 */
export function parseCvText(
  rawText: string,
  knownSkills: CvCatalogSkill[] = [],
  knownLanguages: CvCatalogLanguage[] = [],
): ParsedCvData {
  const text = stripNullBytes(rawText).replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const collapsed = rejoinWrappedCvLines(text).replace(/\n{3,}/g, '\n\n');
  const sections = splitCvSections(collapsed);
  const skillText = sections.skills ?? collapsed;

  return stripNullBytesDeep({
    email: extractEmail(collapsed),
    phone: extractPhone(collapsed),
    headline: extractHeadline(collapsed),
    summary: extractSummary(sections.summary ?? collapsed, Boolean(sections.summary)),
    skillNames: extractSkills(skillText, knownSkills, Boolean(sections.skills)),
    experiences: extractExperiences(sections.experience ?? collapsed, Boolean(sections.experience)),
    educations: extractEducations(sections.education ?? collapsed),
    languages: extractLanguages(sections.languages ?? collapsed, knownLanguages),
    textPreview: collapsed.replace(/\s+/g, ' ').trim().slice(0, 2000),
  });
}
