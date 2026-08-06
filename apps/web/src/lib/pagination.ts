/**
 * Build a compact page window that stays small even for 1000+ pages.
 * Example page=50 / total=1000 → [1, '…', 48, 49, 50, 51, 52, '…', 1000]
 */
export function buildPageWindow(
  page: number,
  totalPages: number,
  siblingCount = 1,
): Array<number | '…'> {
  const total = Math.max(1, Math.floor(totalPages));
  const current = Math.min(Math.max(1, Math.floor(page)), total);

  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const siblings = Math.max(0, siblingCount);
  const left = Math.max(2, current - siblings);
  const right = Math.min(total - 1, current + siblings);

  const out: Array<number | '…'> = [1];

  if (left > 2) out.push('…');
  else if (left === 2) out.push(2);

  for (let p = left; p <= right; p++) {
    if (p !== 1 && p !== total) out.push(p);
  }

  if (right < total - 1) out.push('…');
  else if (right === total - 1) out.push(total - 1);

  if (total > 1) out.push(total);

  // Dedupe while preserving order (edge cases near ends)
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = String(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function clampPage(page: number, totalPages: number): number {
  const total = Math.max(1, totalPages);
  return Math.min(Math.max(1, page || 1), total);
}

export function pageRangeLabel(page: number, limit: number, total: number): string {
  if (total <= 0) return '0 of 0';
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  return `${start}–${end} of ${total}`;
}
