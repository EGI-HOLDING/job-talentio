import { api, ApiError, getToken } from './api';

// Keep an unresolved intent across navigation/refresh. Token refresh must not
// turn an ambiguous response into a second grant or message.
export async function postOnce<T>(path: string, body: unknown = {}) {
  let actor = 'admin';
  try {
    actor =
      JSON.parse(atob((getToken() || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        .sub || actor;
  } catch {}
  const payload = JSON.stringify(body);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(actor + ':' + path + ':' + payload),
  );
  const storageKey =
    'jt-admin-operation:' +
    Array.from(new Uint8Array(digest))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
  let key = pending.get(storageKey);
  try {
    key = sessionStorage.getItem(storageKey) || key;
  } catch {}
  key ||= crypto.randomUUID();
  pending.set(storageKey, key);
  try {
    sessionStorage.setItem(storageKey, key);
  } catch {}
  const clear = () => {
    pending.delete(storageKey);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  };
  try {
    const result = await api<T>(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: payload,
    });
    clear();
    return result;
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 422].includes(error.status)) clear();
    throw error;
  }
}
const pending = new Map<string, string>();
