import { signTelegramLogin, verifyTelegramLogin } from './telegram-login';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TOKEN = 'test-bot-token';

function acceptsValidSignature() {
  const authDate = Math.floor(Date.now() / 1000);
  const base = {
    id: '12345',
    first_name: 'Ada',
    last_name: 'Lovelace',
    username: 'ada',
    auth_date: authDate,
  };
  const hash = signTelegramLogin(base, TOKEN);
  assert(verifyTelegramLogin({ ...base, hash }, TOKEN, authDate), 'valid payload rejected');
}

function rejectsTamperedName() {
  const authDate = Math.floor(Date.now() / 1000);
  const base = { id: '1', first_name: 'Ada', auth_date: authDate };
  const hash = signTelegramLogin(base, TOKEN);
  assert(
    !verifyTelegramLogin({ ...base, first_name: 'Eve', hash }, TOKEN, authDate),
    'tampered name accepted',
  );
}

function rejectsStaleAuthDate() {
  const authDate = Math.floor(Date.now() / 1000) - 90_000;
  const base = { id: '1', first_name: 'Ada', auth_date: authDate };
  const hash = signTelegramLogin(base, TOKEN);
  assert(!verifyTelegramLogin({ ...base, hash }, TOKEN), 'stale payload accepted');
}

acceptsValidSignature();
rejectsTamperedName();
rejectsStaleAuthDate();
console.log('api: telegram-login smoke ok');
