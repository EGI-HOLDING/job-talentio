import { createHash, createHmac, timingSafeEqual } from 'crypto';

const MAX_AGE_SEC = 24 * 60 * 60;

export type TelegramLoginPayload = {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export function telegramFullName(p: { first_name: string; last_name?: string }) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
}

/**
 * Telegram Login Widget hash check.
 * @see https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramLogin(
  payload: TelegramLoginPayload,
  botToken: string,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!botToken) return false;
  if (!Number.isFinite(payload.auth_date)) return false;
  if (payload.auth_date > nowSec + 60) return false;
  if (nowSec - payload.auth_date > MAX_AGE_SEC) return false;

  const data: Record<string, string> = {
    auth_date: String(payload.auth_date),
    first_name: payload.first_name,
    id: String(payload.id),
  };
  if (payload.last_name) data.last_name = payload.last_name;
  if (payload.photo_url) data.photo_url = payload.photo_url;
  if (payload.username) data.username = payload.username;

  const dataCheckString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');

  const secret = createHash('sha256').update(botToken).digest();
  const digest = createHmac('sha256', secret).update(dataCheckString).digest();
  try {
    const given = Buffer.from(payload.hash, 'hex');
    if (given.length !== digest.length) return false;
    return timingSafeEqual(digest, given);
  } catch {
    return false;
  }
}

/** Test helper: sign a payload the same way Telegram does. */
export function signTelegramLogin(
  payload: Omit<TelegramLoginPayload, 'hash'>,
  botToken: string,
): string {
  const data: Record<string, string> = {
    auth_date: String(payload.auth_date),
    first_name: payload.first_name,
    id: String(payload.id),
  };
  if (payload.last_name) data.last_name = payload.last_name;
  if (payload.photo_url) data.photo_url = payload.photo_url;
  if (payload.username) data.username = payload.username;
  const dataCheckString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString).digest('hex');
}
