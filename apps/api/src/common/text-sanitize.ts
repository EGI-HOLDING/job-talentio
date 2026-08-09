/** Fix classic UTF-8→Latin-1 mojibake and placeholder corruption in stored text. */
export function sanitizeStoredText(input?: string | null): string {
  if (!input) return '';
  let s = input
    .replace(/\uFFFD+/g, '')
    // UTF-8 em/en dash / ellipsis misread as Windows-1252
    .replace(/â€”/g, '-')
    .replace(/â€“/g, '-')
    .replace(/â€˜/g, "'")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€¦/g, '...')
    .replace(/Ã—/g, 'x')
    .replace(/\u2014|\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\?{3,}/g, ' - ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}
