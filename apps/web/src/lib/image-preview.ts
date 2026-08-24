/** True when the URL is a real uploaded photo, not a generated initials placeholder. */
export function isPreviewableImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/dicebear\.com/i.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith('/')) return true;
  return false;
}
