import { translateMessage, type MessageLocale } from '@job-talentio/shared';

const TELEGRAM_SAFE = 4000;

/** Fit a chat fan-out into Telegram's message length cap. */
export function formatTelegramChatText(opts: {
  locale: MessageLocale;
  sender: string;
  message: string;
  url: string;
}): string {
  let message = opts.message || '';
  for (let i = 0; i < 6; i++) {
    const text = translateMessage('telegram.chat.body', opts.locale, {
      sender: opts.sender,
      message,
      url: opts.url,
    });
    if (text.length <= TELEGRAM_SAFE) return text;
    const overflow = text.length - TELEGRAM_SAFE;
    const keep = Math.max(0, message.length - overflow - 3);
    if (keep <= 0) break;
    message = `${message.slice(0, keep)}...`;
  }
  return translateMessage('telegram.chat.body', opts.locale, {
    sender: opts.sender,
    message: `${message.slice(0, 160)}...`,
    url: opts.url,
  }).slice(0, TELEGRAM_SAFE);
}

export function isTelegramChatReply(text: string): boolean {
  const trimmed = (text || '').trim();
  return Boolean(trimmed) && !trimmed.startsWith('/');
}
