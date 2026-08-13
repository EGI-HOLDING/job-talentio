import { decideBareStart, decideTokenLink } from './telegram.link';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bareStartRecognizesWidgetLogin() {
  assert(decideBareStart('user-a') === 'already', 'widget-linked chat should greet as already connected');
  assert(decideBareStart(null) === 'help', 'unknown chat should ask them to connect in Settings');
}

function tokenLinkDoesNotSteal() {
  assert(decideTokenLink('user-a', null) === 'ok', 'free chat should attach');
  assert(decideTokenLink('user-a', 'user-a') === 'already', 'same user should be a no-op');
  assert(
    decideTokenLink('user-a', 'user-b') === 'taken',
    'bot /start must not steal a Telegram id the widget linked to someone else',
  );
}

bareStartRecognizesWidgetLogin();
tokenLinkDoesNotSteal();
console.log('api: telegram-link smoke ok');
