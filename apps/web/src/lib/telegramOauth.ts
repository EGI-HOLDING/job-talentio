const TELEGRAM_OAUTH = 'https://oauth.telegram.org';
const BOT_ID_KEY = 'jt_telegram_bot_id';

export function rememberTelegramBotId(botId: string) {
  try {
    sessionStorage.setItem(BOT_ID_KEY, botId);
  } catch {
    /* ignore quota / private mode */
  }
}

export function telegramLogoutUrl(botId: string, origin: string) {
  const q = new URLSearchParams({ bot_id: botId, origin });
  return `${TELEGRAM_OAUTH}/auth/logout?${q.toString()}`;
}

export function telegramOauthPopupUrl(botId: string, lang?: string) {
  const origin = window.location.origin;
  const q = new URLSearchParams({ bot_id: botId, origin });
  if (lang) q.set('lang', lang);
  return `${origin}/telegram-oauth.html?${q.toString()}`;
}

/** Best-effort drop of oauth.telegram.org's remembered account (third-party cookies). */
export function forgetTelegramOauthSession(botId?: string | null) {
  if (typeof window === 'undefined') return;
  let id = botId || '';
  if (!id) {
    try {
      id = sessionStorage.getItem(BOT_ID_KEY) || '';
    } catch {
      id = '';
    }
  }
  if (!id) return;
  const url = telegramLogoutUrl(id, window.location.origin);
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;border:0;left:-9999px;top:-9999px';
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), 4000);
  try {
    void fetch(url, { mode: 'no-cors', credentials: 'include', cache: 'no-store' });
  } catch {
    /* ignore */
  }
}

export function parseTelegramAuthMessage(event: MessageEvent): {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
} | null {
  if (event.origin !== TELEGRAM_OAUTH) return null;
  let data: unknown = event.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const payload = data as { event?: string; result?: unknown };
  if (payload.event !== 'auth_result') return null;
  const user = payload.result;
  if (!user || typeof user !== 'object') return null;
  const parsed = user as {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    auth_date: number;
    hash: string;
  };
  if (typeof parsed.id !== 'number' || !parsed.hash || !parsed.first_name) return null;
  return parsed;
}
