import { normalizePhone } from '../common/dedupe';

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
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'NATIVE';
};

export type ParsedCvMeta = {
  provider: string;
  ocrUsed?: boolean;
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

const DEGREE_MAP: Array<{ re: RegExp; degree: ParsedEducation['degree'] }> = [
  { re: /\b(ph\.?d|doctorate|doktor)\b/i, degree: 'PHD' },
  { re: /\b(master|m\.?sc|mba|magistr)\b/i, degree: 'MASTER' },
  { re: /\b(bachelor|b\.?sc|b\.?a|bakalavr)\b/i, degree: 'BACHELOR' },
  { re: /\b(vocational|college|kollej|texnikum)\b/i, degree: 'VOCATIONAL' },
  { re: /\b(high\s*school|lyceum|litsey|maktab)\b/i, degree: 'HIGH_SCHOOL' },
];

const LANG_HINTS: Array<{ re: RegExp; name: string; code: string }> = [
  { re: /\b(english|ingliz)\b/i, name: 'English', code: 'en' },
  { re: /\b(russian|rus)\b/i, name: 'Russian', code: 'ru' },
  { re: /\b(uzbek|o'?zbek)\b/i, name: "O'zbek", code: 'uz' },
  { re: /\b(german|nemis|deutsch)\b/i, name: 'German', code: 'de' },
  { re: /\b(french|fransuz|fran[cç]ais)\b/i, name: 'French', code: 'fr' },
  { re: /\b(turkish|turk)\b/i, name: 'Turkish', code: 'tr' },
  { re: /\b(chinese|kitay|mandarin)\b/i, name: 'Chinese', code: 'zh' },
  { re: /\b(korean|koreys)\b/i, name: 'Korean', code: 'ko' },
  { re: /\b(arabic|arab)\b/i, name: 'Arabic', code: 'ar' },
];

const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function toIsoDate(year: string, monthHint?: string): string {
  let month = '01';
  if (monthHint) {
    const m = monthHint.toLowerCase().slice(0, 3);
    const map: Record<string, string> = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };
    month = map[m] || '01';
  }
  return `${year}-${month}-01`;
}

function extractEmail(text: string): string | undefined {
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m?.[0]?.toLowerCase();
}

function extractPhone(text: string): string | undefined {
  const m = text.match(/(?:\+?998[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?\d{3}[\s-]?\d{2}[\s-]?\d{2}|\+\d{10,15}/);
  if (!m) return undefined;
  try {
    return normalizePhone(m[0]);
  } catch {
    return m[0].replace(/\s+/g, '');
  }
}

function extractSkills(text: string, knownSkills: Array<{ name: string; slug: string }>): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const s of knownSkills) {
    const name = s.name.toLowerCase();
    if (name.length < 2) continue;
    // word-ish boundary: avoid matching short substrings inside other words when name is short
    const re = new RegExp(`(?:^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i');
    if (re.test(lower) || lower.includes(name)) {
      found.push(s.name);
    }
  }
  return Array.from(new Set(found)).slice(0, 40);
}

function extractLanguages(text: string): ParsedLanguage[] {
  const out: ParsedLanguage[] = [];
  for (const hint of LANG_HINTS) {
    const re = new RegExp(
      `(${hint.re.source})\\s*[:\\-–]?\\s*(native|mother\\s*tongue|ona\\s*tili|c2|c1|b2|b1|a2|a1|fluent|advanced|intermediate|elementary|basic|beginner)?`,
      'i',
    );
    const m = text.match(re);
    if (!m) continue;
    let level: ParsedLanguage['level'] = 'B1';
    const lvlRaw = (m[2] || '').toLowerCase();
    if (/native|mother|ona/.test(lvlRaw)) level = 'NATIVE';
    else if (lvlRaw === 'c2' || lvlRaw === 'fluent') level = 'C2';
    else if (lvlRaw === 'c1' || lvlRaw === 'advanced') level = 'C1';
    else if (lvlRaw === 'b2') level = 'B2';
    else if (lvlRaw === 'b1' || lvlRaw === 'intermediate') level = 'B1';
    else if (lvlRaw === 'a2' || lvlRaw === 'elementary') level = 'A2';
    else if (lvlRaw === 'a1' || lvlRaw === 'basic' || lvlRaw === 'beginner') level = 'A1';
    out.push({ name: hint.name, code: hint.code, level });
  }
  return out;
}

function extractExperiences(text: string): ParsedExperience[] {
  const experiences: ParsedExperience[] = [];
  const dateRe = new RegExp(
    `((?:${MONTHS})\\s+)?(20\\d{2}|19\\d{2})\\s*[-–—to]+\\s*((?:${MONTHS})\\s+)?(20\\d{2}|19\\d{2}|present|now|current|hozir)`,
    'gi',
  );
  const eduHint =
    /\b(university|universitet|institute|institut|college|kollej|academy|bachelor|master|ph\.?d|education)\b/i;

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const chunks =
    lines.length > 3
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
    if (eduHint.test(line) || eduHint.test(prev) || eduHint.test(next)) continue;

    const startDate = toIsoDate(dm[2], dm[1]?.trim());
    const endRaw = (dm[4] || '').toLowerCase();
    const isCurrent = /present|now|current|hozir/.test(endRaw);
    const endDate = isCurrent ? null : toIsoDate(dm[4], dm[3]?.trim());

    let title = prev;
    let companyName = '';

    const atMatch = prev.match(/^(.{3,80}?)\s+(?:at|@|\||–|-|,)\s+(.{2,80})$/i);
    if (atMatch) {
      title = atMatch[1].trim();
      companyName = atMatch[2].trim();
    } else if (next && next.length < 80 && !dateRe.test(next) && !eduHint.test(next)) {
      companyName = next;
    }

    if (!title || title.length < 2) title = 'Role';
    if (!companyName) companyName = 'Company';

    experiences.push({
      title: title.slice(0, 160),
      companyName: companyName.slice(0, 160),
      startDate,
      endDate,
      isCurrent,
      description: next && next !== companyName ? next.slice(0, 500) : undefined,
    });
  }

  return experiences.slice(0, 12);
}

function extractEducations(text: string): ParsedEducation[] {
  const educations: ParsedEducation[] = [];
  const uniRe =
    /\b(university|universitet|institute|institut|college|kollej|academy|akademiya)\b/i;
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const chunks =
    lines.length > 3
      ? lines
      : text.split(/(?<=[.!?])\s+|\s{2,}|[•●▪]/).map((l) => l.trim()).filter((l) => l.length > 3);

  for (let i = 0; i < chunks.length; i++) {
    const line = chunks[i];
    if (!uniRe.test(line) && !DEGREE_MAP.some((d) => d.re.test(line))) continue;

    let degree: ParsedEducation['degree'];
    for (const d of DEGREE_MAP) {
      if (d.re.test(line) || (chunks[i + 1] && d.re.test(chunks[i + 1]))) {
        degree = d.degree;
        break;
      }
    }

    const yearMatch = line.match(/(20\d{2}|19\d{2})/g);
    const startDate = yearMatch?.[0] ? `${yearMatch[0]}-01-01` : null;
    const endDate = yearMatch?.[1] ? `${yearMatch[1]}-01-01` : null;

    educations.push({
      school: line.slice(0, 200),
      degree,
      field: chunks[i + 1] && !uniRe.test(chunks[i + 1]) ? chunks[i + 1].slice(0, 160) : undefined,
      startDate,
      endDate,
    });
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
    /\b(engineer|developer|designer|manager|analyst|specialist|lead|architect|consultant|backend|frontend|full[- ]?stack)\b/i.test(
      l,
    ),
  );
  return (roleLike || candidates[1] || candidates[0])?.slice(0, 120);
}

function extractSummary(text: string): string | undefined {
  const about = text.match(
    /(?:summary|profile|about\s+me|objective|professional\s+summary)\s*[:\n-]+\s*([\s\S]{40,600}?)(?=\n\s*(?:experience|education|skills|work|employment)\b|$)/i,
  );
  if (about?.[1]) return about[1].replace(/\s+/g, ' ').trim().slice(0, 1000);
  // Fallback: first substantial paragraph
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
 * Pass known skill names from DB so matching stays accurate.
 */
export function parseCvText(
  rawText: string,
  knownSkills: Array<{ name: string; slug: string }> = [],
): ParsedCvData {
  const text = stripNullBytes(rawText).replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const collapsed = text.replace(/\n{3,}/g, '\n\n');

  return stripNullBytesDeep({
    email: extractEmail(collapsed),
    phone: extractPhone(collapsed),
    headline: extractHeadline(collapsed),
    summary: extractSummary(collapsed),
    skillNames: extractSkills(collapsed, knownSkills),
    experiences: extractExperiences(collapsed),
    educations: extractEducations(collapsed),
    languages: extractLanguages(collapsed),
    textPreview: collapsed.replace(/\s+/g, ' ').trim().slice(0, 2000),
  });
}
