/** Replace corrupted mojibake placeholders left by bad UTF-8 seed/import paths. */
export function sanitizeMojibake(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/\uFFFD+/g, '')
    .replace(/\?{3,}/g, ' - ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
