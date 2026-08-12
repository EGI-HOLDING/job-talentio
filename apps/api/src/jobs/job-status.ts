import { JobStatus } from '@prisma/client';

/**
 * Best-practice status graph: close or pause from live posts; reopen CLOSED to
 * PUBLISHED (or DRAFT to edit). Kept apart from JobsService so the admin bulk
 * path can enforce the same rules without importing the whole service.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  DRAFT: ['PUBLISHED', 'CLOSED'],
  PUBLISHED: ['PAUSED', 'CLOSED'],
  PAUSED: ['PUBLISHED', 'CLOSED'],
  CLOSED: ['PUBLISHED', 'DRAFT'],
  EXPIRED: ['PUBLISHED', 'CLOSED'],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return (ALLOWED_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

export function transitionError(from: JobStatus, to: JobStatus): string {
  const allowed = ALLOWED_STATUS_TRANSITIONS[from] ?? [];
  return `Cannot change job status from ${from} to ${to}. Allowed: ${allowed.join(', ') || 'none'}.`;
}
