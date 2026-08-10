/**
 * Normalized catalog labels (via normalizeLookupKey) that must not be created.
 * Keep entries lowercase alphanumeric / Cyrillic only (no spaces/punctuation).
 */
export const CATALOG_BLOCKLIST = new Set([
  // English
  'fuck',
  'fucker',
  'fucking',
  'shit',
  'bullshit',
  'bitch',
  'bastard',
  'asshole',
  'dick',
  'cock',
  'cunt',
  'piss',
  'whore',
  'slut',
  'idiot',
  'stupid',
  'dumbass',
  'motherfucker',
  'mf',
  'wtf',
  'stfu',
  'faggot',
  'nigger',
  'nigga',
  // Russian (normalized)
  'хуй',
  'хуи',
  'хуя',
  'пизда',
  'пиздец',
  'блядь',
  'блять',
  'бля',
  'сука',
  'ебать',
  'ебан',
  'ебаный',
  'ёб',
  'говн',
  'говно',
  'мудак',
  'мразь',
  'жопа',
  'залупа',
  'пидор',
  'пидар',
  'дебил',
  'даун',
  // Uzbek Latin (common abusive / spam)
  'ahmoq',
  'tentak',
  'jinni',
  'harom',
  'haramzada',
  'qotoq',
  'amasing',
  'amsing',
  'jallad',
  // spam / throwaway
  'asdf',
  'asdfgh',
  'qwer',
  'qwerty',
  'zxcv',
  'zxcvbn',
  'test',
  'testing',
  'xxx',
  'xxxx',
  'aaaa',
  'bbbb',
  'null',
  'undefined',
  'none',
  'nouse',
  'spam',
  'dummy',
]);

/** True if normalized key is blocklisted (exact) or embeds a long abusive token. */
export function isBlockedCatalogKey(normalizedKey: string): boolean {
  const key = (normalizedKey || '').trim().toLowerCase();
  if (!key) return true;
  if (CATALOG_BLOCKLIST.has(key)) return true;
  for (const bad of CATALOG_BLOCKLIST) {
    // Avoid short-token false positives (e.g. "test" inside longer words).
    if (bad.length >= 5 && key.includes(bad)) return true;
  }
  return false;
}
