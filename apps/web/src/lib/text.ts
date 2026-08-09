/**
 * Fix classic UTF-8 to Windows-1252 mojibake and normalize risky Unicode punctuation.
 * Patterns use \u escapes so source stays ASCII-safe under encoding mishaps.
 */
export function sanitizeMojibake(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/\uFFFD+/g, '')
    .replace(/\u00E2\u20AC\u201D/g, '-')
    .replace(/\u00E2\u20AC\u201C/g, '-')
    .replace(/\u00E2\u20AC\u2122/g, "'")
    .replace(/\u00E2\u20AC\u02DC/g, "'")
    .replace(/\u00E2\u20AC\u0153/g, '"')
    .replace(/\u00E2\u20AC\u009D/g, '"')
    .replace(/\u00E2\u20AC\u00A6/g, '...')
    .replace(/\u00C3\u00D7/g, 'x')
    .replace(/\u00C2\u00B7/g, ' | ')
    .replace(/\u00C2 /g, ' ')
    .replace(/\u2014|\u2013|\u2212/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00B7|\u2022/g, ' | ')
    .replace(/\?{3,}/g, ' - ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/ \|  \| /g, ' | ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
