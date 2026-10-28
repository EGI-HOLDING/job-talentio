/** Pure import rules so a local parse cannot invent dates or duplicate a profile. */

export function resumeStartDate(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  return new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10) ? parsed : null;
}

function dateOf(value?: string | Date | null): string {
  if (!value) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return resumeStartDate(value)?.toISOString().slice(0, 10) ?? '';
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function experienceImportKey(
  title: string,
  companyName: string,
  startDate?: string | Date | null,
): string {
  return JSON.stringify([norm(title), norm(companyName), dateOf(startDate)]);
}

export function educationImportKey(
  school: string,
  degree: string | null | undefined,
  startDate?: string | Date | null,
): string {
  return JSON.stringify([norm(school), degree || '', dateOf(startDate)]);
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
