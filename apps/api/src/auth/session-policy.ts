/** Pure session-hardening rules used by AuthService and Telegram webhooks. */

export function isDevLoginAllowed(devAuthEnabled: boolean, secureRuntime: boolean): boolean {
  return devAuthEnabled && !secureRuntime;
}

/** Staging/prod must not accept unsigned Telegram webhooks when the bot is live. */
export function telegramWebhookSecretRequired(
  secureRuntime: boolean,
  telegramConfigured: boolean,
  secret: string,
): boolean {
  return secureRuntime && telegramConfigured && !secret.trim();
}
