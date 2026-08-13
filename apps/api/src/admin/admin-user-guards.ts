export const ANONYMIZED_DISPLAY_NAME = 'Deleted user';

/** Shared refusals for support actions: never lock out the console or a peer admin. */
export function supportTargetError(
  actorId: string,
  target: { id: string; role: string },
): string | null {
  if (target.id === actorId) return 'Cannot do this to your own account';
  if (target.role === 'SUPER_ADMIN') return 'Cannot do this to a super admin';
  return null;
}
