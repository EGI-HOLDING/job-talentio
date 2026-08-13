/**
 * Login Widget `id` and a private 1:1 bot chat id are the same number, so one
 * User.telegramId covers sign-in and job-alert delivery. Bot /start must not
 * steal a chat that the widget already attached to someone else.
 */
export type BareStartDecision = 'already' | 'help';

export function decideBareStart(linkedUserId: string | null): BareStartDecision {
  return linkedUserId ? 'already' : 'help';
}

export type TokenLinkDecision = 'ok' | 'already' | 'taken';

export function decideTokenLink(
  tokenUserId: string,
  chatOwnerId: string | null,
): TokenLinkDecision {
  if (!chatOwnerId) return 'ok';
  if (chatOwnerId === tokenUserId) return 'already';
  return 'taken';
}
