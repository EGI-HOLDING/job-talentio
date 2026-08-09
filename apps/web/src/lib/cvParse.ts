import { api } from '@/lib/api';

export type ResumeParseStatus = 'NONE' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export type ResumeParseStatusResponse = {
  id: string;
  parseStatus: ResumeParseStatus;
  parseError?: string | null;
  parsedAt?: string | null;
  parsedData?: unknown;
  needsReview?: boolean;
};

const TERMINAL: ResumeParseStatus[] = ['READY', 'FAILED', 'NONE'];

/** Soft-poll until parse completes. Keeps UI responsive; does not block the upload request. */
export async function waitForResumeParse(
  resumeId: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<ResumeParseStatusResponse> {
  const intervalMs = opts?.intervalMs ?? 1500;
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const status = await api<ResumeParseStatusResponse>(
      `/profiles/me/resumes/${resumeId}/parse-status`,
    );
    if (TERMINAL.includes(status.parseStatus)) return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    id: resumeId,
    parseStatus: 'PENDING',
    parseError: 'Parse is still running - check back shortly',
    needsReview: false,
  };
}

export function isParseInFlight(status?: string | null) {
  return status === 'PENDING' || status === 'PROCESSING';
}
