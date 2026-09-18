/**
 * Phone identity helpers. Numbers are stored in E.164 (`+998901234567`) so a
 * Telegram contact, an SMS form and a profile field all resolve to one account.
 */
export const PHONE_LOGIN_TTL_MS = 10 * 60 * 1000;
export const PHONE_OTP_TTL_MS = 5 * 60 * 1000;
export const PHONE_OTP_MAX_ATTEMPTS = 5;

/** `phone_<token>` is the /start payload the web hands to the bot for a sign-in. */
export const PHONE_START_PREFIX = 'phone_';

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // Local Uzbek formats: 9 digits (901234567) or 12 starting with 998.
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Bot deep link that opens the chat with the sign-in payload preloaded. */
export function phoneLoginDeepLink(botUsername: string, rawToken: string): string {
  return `https://t.me/${botUsername.replace(/^@/, '')}?start=${PHONE_START_PREFIX}${rawToken}`;
}

export function parsePhoneStartPayload(payload: string | undefined): string | null {
  if (!payload || !payload.startsWith(PHONE_START_PREFIX)) return null;
  const token = payload.slice(PHONE_START_PREFIX.length);
  return /^[a-f0-9]{32,96}$/i.test(token) ? token : null;
}

/** Masks all but the last two digits for confirmation messages. */
export function maskPhone(phone: string): string {
  return phone.replace(/\d(?=\d{2})/g, '*');
}

export function generateOtpCode(): string {
  // 6 digits, leading zeros allowed.
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}
