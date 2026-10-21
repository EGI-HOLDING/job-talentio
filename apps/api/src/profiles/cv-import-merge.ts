/** Pure import rules so a local parse cannot invent dates or duplicate a profile. */

export function resumeStartDate(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function yearOf(value?: string | Date | null): string {
  if (!value) return '';
  if (value instanceof Date) return String(value.getUTCFullYear());
  const match = String(value).match(/(?:19|20)\d{2}/);
  return match?.[0] ?? '';
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function experienceImportKey(
  title: string,
  companyName: string,
  startDate?: string | Date | null,
): string {
  return `${norm(title)}|${norm(companyName)}|${yearOf(startDate)}`;
}

export function educationImportKey(
  school: string,
  degree: string | null | undefined,
  startDate?: string | Date | null,
): string {
  return `${norm(school)}|${degree || ''}|${yearOf(startDate)}`;
}

export function pickFilledProfileFields<T extends Record<string, string | undefined>>(
  existing: T,
  incoming: T,
  replaceExisting: boolean,
): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(incoming) as Array<keyof T>) {
    const next = incoming[key]?.trim();
    if (!next) continue;
    const current = existing[key]?.trim();
    if (replaceExisting || !current) patch[key] = next as T[keyof T];
  }
  return patch;
}
