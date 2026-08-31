/**
 * IdP mailbox trust. Google may prove the address in the ID token.
 * Telegram Login never proves a typed inbox, even when the widget collected one.
 */

export function googleTokenEmailVerified(
  payload: { email_verified?: boolean } | null | undefined,
): boolean {
  return payload?.email_verified === true;
}

/** True when Google's token is allowed to mark this stored mailbox verified. */
export function shouldMarkGoogleMailboxVerified(opts: {
  tokenEmail: string;
  tokenEmailVerified: boolean;
  storedEmail: string | null | undefined;
}): boolean {
  if (!opts.tokenEmailVerified) return false;
  const token = opts.tokenEmail.trim().toLowerCase();
  const stored = (opts.storedEmail ?? '').trim().toLowerCase();
  if (!token) return false;
  if (!stored) return true;
  return stored === token;
}

/** Telegram-typed emails stay unverified until the user clicks a platform link. */
export function telegramTypedEmailVerified(): boolean {
  return false;
}
