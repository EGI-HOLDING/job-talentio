import { api, ApiError, getSession } from './api';
const pending = new Map<string, string>();
/** Keep the same intent key after a timeout, including a page refresh. */
export async function postOnce<T>(path: string, body: unknown = {}, options: {signal?: AbortSignal} = {}) {
  const payload = JSON.stringify(body);
  const actor = getSession()?.user.id || 'guest';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(actor + ':' + path + ':' + payload),
  );
  if (actor !== (getSession()?.user.id || 'guest')) throw new ApiError('Account changed. Please retry.', 409);
  const storageKey =
    'jt-operation:' +
    Array.from(new Uint8Array(digest))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
  let stored = pending.get(storageKey);
  try { stored = sessionStorage.getItem(storageKey) || stored; } catch {}
  const key = stored || crypto.randomUUID();
  pending.set(storageKey, key);
  try { sessionStorage.setItem(storageKey, key); } catch {}
  const clear = () => { pending.delete(storageKey); try { sessionStorage.removeItem(storageKey); } catch {} };
  try {
    const result = await api<T>(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: payload,
      signal: options.signal,
    });
    clear();
    return result;
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 422].includes(error.status))
      clear();
    throw error;
  }
}
