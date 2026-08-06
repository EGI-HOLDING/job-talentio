import { createHash } from 'crypto';

/** Lowercase + trim; strips Gmail-style dots/plus for common providers when checking dupes. */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [local, domain] = trimmed.split('@');
  if (!local || !domain) return trimmed;

  const aliases = new Set(['gmail.com', 'googlemail.com']);
  if (aliases.has(domain)) {
    const withoutPlus = local.split('+')[0] ?? local;
    const withoutDots = withoutPlus.replace(/\./g, '');
    return `${withoutDots}@gmail.com`;
  }
  return `${local}@${domain}`;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('998') && !digits.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('8') && digits.length >= 10) return `+998${digits.slice(1)}`;
  return digits;
}

/** Collapse punctuation/spacing so "Senior React Dev!" ≈ "senior react dev". */
export function normalizeJobTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яёўғқҳ\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яёўғқҳ\s]+/gi, ' ')
    .replace(/\b(llc|ltd|inc|ooo|мчж|мчж\.|ООО)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTextContent(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function jobFingerprint(input: {
  title: string;
  workMode: string;
  cityId?: string | null;
}): string {
  return sha256(
    `${normalizeJobTitle(input.title)}|${input.workMode}|${input.cityId ?? 'none'}`,
  );
}

export function contentHash(description: string): string {
  return sha256(normalizeTextContent(description));
}

export function titlesNearlyIdentical(a: string, b: string): boolean {
  const na = normalizeJobTitle(a);
  const nb = normalizeJobTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Containment for near-dupes like "Senior React Developer" vs "Senior React Developer (Tashkent)"
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return shorter >= 12 && shorter / longer >= 0.85;
  }
  return false;
}
