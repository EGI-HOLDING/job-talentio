import { api } from './api';
import { readSource } from './acquisition';
type EventKind = 'IMPRESSION' | 'DETAIL_VIEW' | 'APPLY_CLICK' | 'APPLY_START';
const pending = new Map<string, Promise<void>>();
export function trackJobEvent(jobId: string, kind: EventKind): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const run = async () => {
    try {
      let visitor = localStorage.getItem('jt-event-visitor');
      if (!visitor) {
        visitor = crypto.randomUUID();
        localStorage.setItem('jt-event-visitor', visitor);
      }
      const key = 'jt-event:' + jobId + ':' + kind + ':' + Math.floor(Date.now() / 1800000);
      if (sessionStorage.getItem(key)) return;
      const source =
        readSource(jobId)
          ?.replace(/[^a-zA-Z0-9:_-]/g, '')
          .slice(0, 40) || undefined;
      const result = await api<{ session?: string }>('/hr-events', {
        method: 'POST',
        body: JSON.stringify({ jobId, kind, visitor, source }),
      });
      if (result.session) {
        sessionStorage.setItem(key, '1');
        sessionStorage.setItem(
          'jt-attribution:' + jobId,
          JSON.stringify({ token: result.session, until: Date.now() + 7 * 86400000 }),
        );
      }
    } catch {
      /* Telemetry never blocks a job or application. */
    }
  };
  const previous = pending.get(jobId) || Promise.resolve();
  const promise = previous.then(run);
  pending.set(jobId, promise);
  void promise.finally(() => {
    if (pending.get(jobId) === promise) pending.delete(jobId);
  });
  return promise;
}
export async function jobAttribution(jobId: string) {
  await pending.get(jobId);
  try {
    const value = JSON.parse(sessionStorage.getItem('jt-attribution:' + jobId) || 'null');
    return value?.until > Date.now() ? (value.token as string) : undefined;
  } catch {
    return undefined;
  }
}
