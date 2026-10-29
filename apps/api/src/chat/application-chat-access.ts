export function applicationChatAllowed(status: string | null | undefined) {
  return status !== 'WITHDRAWN';
}
