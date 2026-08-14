import { isDevLoginAllowed, telegramWebhookSecretRequired } from './session-policy';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function devLoginStaysLocalOnly() {
  assert(isDevLoginAllowed(true, false), 'local DEV_AUTH_ENABLED must still work');
  assert(!isDevLoginAllowed(true, true), 'secure runtime must refuse passwordless dev login');
  assert(!isDevLoginAllowed(false, false), 'flag off must refuse even locally');
  assert(!isDevLoginAllowed(false, true), 'flag off must refuse in secure runtime');
}

function telegramSecretRequiredInSecureRuntime() {
  assert(
    telegramWebhookSecretRequired(true, true, ''),
    'live bot on staging/prod must require a webhook secret',
  );
  assert(
    !telegramWebhookSecretRequired(true, true, 'set-secret'),
    'configured secret is enough',
  );
  assert(
    !telegramWebhookSecretRequired(true, false, ''),
    'no bot configured: do not fail closed on an unused webhook',
  );
  assert(
    !telegramWebhookSecretRequired(false, true, ''),
    'local/dev may run the bot without a secret',
  );
}

devLoginStaysLocalOnly();
telegramSecretRequiredInSecureRuntime();
console.log('api: session-policy smoke ok');
