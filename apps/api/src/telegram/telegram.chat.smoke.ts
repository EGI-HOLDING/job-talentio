import { formatTelegramChatText, isTelegramChatReply } from './telegram.chat';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const long = 'x'.repeat(5000);
const formatted = formatTelegramChatText({
  locale: 'en',
  sender: 'Ada',
  message: long,
  url: 'https://staging.jobtalent.io/en/messages?peer=u1',
});
assert(formatted.length <= 4000, 'telegram chat body must stay under the cap');
assert(formatted.includes('Ada'), 'sender name is kept');
assert(formatted.includes('https://staging.jobtalent.io/en/messages?peer=u1'), 'reply url is kept');
assert(isTelegramChatReply('Hello from Telegram'), 'plain text is a chat reply');
assert(!isTelegramChatReply('/start abc'), 'slash commands are not chat replies');
assert(!isTelegramChatReply(''), 'empty is not a chat reply');

console.log('api: telegram-chat smoke ok');
