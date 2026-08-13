import { isLocale, type Locale } from './locale';

/**
 * Cheap language guess for free text we already store, used to repair rows whose
 * `locale` was never set and silently fell back to the schema default. It only
 * has to separate Uzbek, Russian and English, so word lists beat a dependency.
 */

/** Cyrillic decides Russian outright; Uzbek here is written in Latin script. */
const CYRILLIC = /[\u0400-\u04FF]/;

const UZBEK_WORDS = [
  'va',
  'bilan',
  'uchun',
  'ish',
  'ishlash',
  'tajriba',
  'kerak',
  'bo',
  'talab',
  'talablar',
  'vazifalar',
  'xodim',
  'lavozim',
  'maosh',
  'oylik',
  'kompaniya',
  'rivojlantirish',
  'bilim',
  'malaka',
  'mutaxassis',
  'jamoa',
  'loyiha',
  'yaxshi',
  'zarur',
  'quyidagi',
  'sharoit',
  'imkoniyat',
];

const ENGLISH_WORDS = [
  'the',
  'and',
  'for',
  'with',
  'you',
  'will',
  'are',
  'our',
  'experience',
  'requirements',
  'responsibilities',
  'team',
  'work',
  'role',
  'skills',
  'benefits',
  'about',
  'years',
  'company',
  'we',
  'is',
  'to',
  'in',
  'of',
  'this',
  'that',
  'looking',
  'seeking',
  'join',
];

/** Uzbek-specific letter pairs that English text effectively never contains. */
const UZBEK_MARKERS = /(o['\u2018\u2019]|g['\u2018\u2019])/;

function countWords(words: string[], tokens: string[]): number {
  const set = new Set(tokens);
  return words.reduce((total, word) => total + (set.has(word) ? 1 : 0), 0);
}

/**
 * Returns null when the text gives no clear signal, so callers can leave the
 * stored value alone instead of guessing.
 */
export function detectLocale(text: string): Locale | null {
  const sample = text.slice(0, 4000);
  if (!sample.trim()) return null;

  const cyrillic = (sample.match(/[\u0400-\u04FF]/g) ?? []).length;
  if (CYRILLIC.test(sample) && cyrillic / sample.length > 0.1) return 'ru';

  const tokens = sample
    .toLowerCase()
    .split(/[^a-z\u2018\u2019']+/)
    .filter(Boolean);
  if (tokens.length < 5) return null;

  const hasUzbekMarker = UZBEK_MARKERS.test(sample);
  const uzbekWords = countWords(UZBEK_WORDS, tokens);
  const uzbek = uzbekWords + (hasUzbekMarker ? 3 : 0);
  const english = countWords(ENGLISH_WORDS, tokens);

  if (english > 0 && uzbekWords === 0 && !hasUzbekMarker) return 'en';
  if (english >= uzbek + 2) return 'en';
  if (uzbek >= english + 2) return 'uz';
  return null;
}

/**
 * Language the text is actually in. A confident detect always wins so a stale
 * schema default of `uz` cannot keep tagging English copy as Uzbek.
 */
export function effectiveSourceLocale(
  stored: string | null | undefined,
  text: string,
): Locale | null {
  const detected = detectLocale(text);
  if (detected) return detected;
  if (isLocale(stored)) return stored;
  return null;
}

/** Locale to persist on write: detect, then an explicit client value, then existing. */
export function pickStoredLocale(input: {
  text?: string | null;
  explicit?: string | null;
  existing?: string | null;
}): Locale | null {
  const detected = input.text ? detectLocale(input.text) : null;
  if (detected) return detected;
  if (isLocale(input.explicit)) return input.explicit;
  if (isLocale(input.existing)) return input.existing;
  return null;
}
