export function applicationChatAllowed(status: string | null | undefined) {
  return status !== 'WITHDRAWN';
}

/** An employee-initiated conversation must be tied to an application for this job. */
const EMPLOYEE_CHAT_APPLICATION_STATUSES = new Set([
  'NEW',
  'IN_REVIEW',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
]);

export function employeeApplicationChatAllowed(status: string | null | undefined) {
  return Boolean(status && EMPLOYEE_CHAT_APPLICATION_STATUSES.has(status));
}
