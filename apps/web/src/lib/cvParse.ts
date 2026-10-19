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
  opts?: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<ResumeParseStatusResponse> {
  const intervalMs = opts?.intervalMs ?? 1500;
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const status = await api<ResumeParseStatusResponse>(
      `/profiles/me/resumes/${resumeId}/parse-status`,
      { signal: opts?.signal },
    );
    if (TERMINAL.includes(status.parseStatus)) return status;
    await new Promise<void>((resolve, reject) => {
      const signal = opts?.signal;
      const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(finish, intervalMs);
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
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
