import { DEFAULT_LOCALE, localeFromPathname } from '@/lib/locale';
import { resourceCache } from './resourceCache';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Catalog labels (cities, categories, skills) are localized server-side, so
 * every request advertises the active language. Middleware guarantees the URL
 * carries the locale, which keeps this in sync with what the user sees.
 */
function activeLocale(): string {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  return localeFromPathname(window.location.pathname) ?? DEFAULT_LOCALE;
}

export type AuthSession = {
  accessToken: string;
  refreshToken?: string;
  user: {
    id: string;
    email: string | null;
    fullName: string;
    role: string;
    locale?: string;
    avatarUrl?: string | null;
    emailVerified?: boolean;
    telegramLinked?: boolean;
    /** E.164 login phone, set after a Telegram contact share or SMS code. */
    phone?: string | null;
    hasPassword?: boolean;
    memberships?: Array<{ companyId: string; role: string }>;
    employeeProfileId?: string | null;
    employeeOnboarding?: {status: 'NOT_REQUIRED'|'IN_PROGRESS'|'COMPLETED';step:number} | null;
    recruiterOnboarding?: {status: 'NOT_REQUIRED'|'IN_PROGRESS'|'COMPLETE';step:number} | null;
  };
};

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jt_token');
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jt_refresh');
}

export function getSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('jt_session');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession) {
  localStorage.setItem('jt_token', session.accessToken);
  if (session.refreshToken) {
    localStorage.setItem('jt_refresh', session.refreshToken);
  }
  localStorage.setItem('jt_session', JSON.stringify(session));
  ensureCacheIdentity();
  window.dispatchEvent?.(new Event('jt-session-updated'));
}

export function clearSession() {
  localStorage.removeItem('jt_token');
  localStorage.removeItem('jt_refresh');
  localStorage.removeItem('jt_session');
  ensureCacheIdentity();
  window.dispatchEvent?.(new Event('jt-session-updated'));
}

/** Revoke the refresh token server-side (best effort), then clear local session. */
export async function logout() {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      /* offline logout still clears local state */
    }
  }
  clearSession();
}

// Single in-flight refresh shared by concurrent 401s.
let refreshPromise: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return null;
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        // A different tab/login may have replaced this session while rotation ran.
        // Never overwrite or clear the newer account with the old response.
        if (refreshToken !== getRefreshToken()) return null;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            clearSession();
            return null;
          }
          const body: unknown = await res.json().catch(() => null);
          throw new ApiError(formatApiError(body, res.statusText || 'Session refresh failed'), res.status);
        }
        const session = (await res.json()) as AuthSession;
        if (refreshToken !== getRefreshToken()) return null;
        saveSession(session);
        return session.accessToken;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

type NestErrorBody = {
  message?: unknown;
  error?: unknown;
  errors?: {
    formErrors?: string[];
    fieldErrors?: Record<string, string[] | undefined>;
  };
};

/** Flatten NestJS / Zod validation payloads into a readable string. */
export function formatApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const body = data as NestErrorBody;

  const fromFlatten = (errors: NestErrorBody['errors']): string | null => {
    if (!errors) return null;
    const parts = [
      ...(errors.formErrors ?? []),
      ...Object.entries(errors.fieldErrors ?? {}).flatMap(([field, msgs]) =>
        (msgs ?? []).map((m) => `${field}: ${m}`),
      ),
    ].filter(Boolean);
    return parts.length ? parts.join('. ') : null;
  };

  const msg = body.message;

  if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
    const nested = msg as NestErrorBody;
    const flat = fromFlatten(nested.errors ?? body.errors);
    if (flat) return flat;
    if (typeof nested.message === 'string') return nested.message;
  }

  if (typeof msg === 'string') {
    if (msg === 'Validation failed') {
      const flat = fromFlatten(body.errors);
      if (flat) return flat;
    }
    return msg;
  }

  if (Array.isArray(msg)) {
    return msg.map(String).join('. ');
  }

  const flat = fromFlatten(body.errors);
  if (flat) return flat;

  if (typeof body.error === 'string') return body.error;
  return fallback;
}

async function apiNetwork<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('X-Locale')) headers.set('X-Locale', activeLocale());
  const useAuth = auth;
  // Authenticated resources use the account-scoped memory cache above. Do not
  // keep a second browser HTTP cache across token rotation or account changes.
  const networkOptions = { ...requestOptions, ...(useAuth ? { cache: 'no-store' as const } : {}) };
  const actor = getSession()?.user.id;
  if (useAuth) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  let res = await fetch(`${API_URL}/api${path}`, { ...networkOptions, headers });
  if (useAuth && actor !== getSession()?.user.id) throw new ApiError('Account changed. Please retry.', 409);

  // Expired access token: silently rotate once via the refresh token, then retry.
  if (res.status === 401 && useAuth && getToken() && path !== '/auth/refresh') {
    const rotated = await tryRefresh();
    if (actor !== getSession()?.user.id) throw new ApiError('Account changed. Please retry.', 409);
    if (rotated) {
      headers.set('Authorization', `Bearer ${rotated}`);
      res = await fetch(`${API_URL}/api${path}`, { ...networkOptions, headers });
    }
  }

  // A conditional response has no JSON body. Recover once from an exposed 304
  // instead of turning a successful token refresh into an empty/error screen.
  if (res.status === 304 && ['GET', 'HEAD'].includes((requestOptions.method || 'GET').toUpperCase())) {
    headers.delete('If-None-Match');
    headers.delete('If-Modified-Since');
    headers.set('Cache-Control', 'no-cache');
    res = await fetch(`${API_URL}/api${path}`, { ...networkOptions, cache: 'no-store', headers });
  }

  const text = await res.text();
  if (useAuth && actor !== getSession()?.user.id) throw new ApiError('Account changed. Please retry.', 409);
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    throw new ApiError(formatApiError(data, res.statusText || 'Request failed'), res.status);
  }
  return data as T;
}

export type ApiOptions = RequestInit & { auth?: boolean; cacheMode?: 'reload' | 'no-store' };
let cacheIdentity: string | undefined;
let cacheChannel: BroadcastChannel | undefined;
let cacheListening = false;
function scope() { const user = getSession()?.user; return user ? `${user.id}:${user.role}` : 'anonymous'; }
function ensureCacheIdentity() {
  if (typeof window === 'undefined') return;
  const next = scope();
  if (cacheIdentity !== next) { cacheIdentity = next; resourceCache.invalidate(key => JSON.parse(key)[0] !== 'public'); }
  if (!cacheListening && window.addEventListener) {
    cacheListening = true; window.addEventListener('storage', ensureCacheIdentity);
    if (typeof BroadcastChannel !== 'undefined') {
      cacheChannel = new BroadcastChannel('talentio-candidate-cache');
      cacheChannel.onmessage = event => { if (event.data?.type === 'invalidate') invalidateApi(event.data.prefixes, false, event.data.scope); };
    }
  }
}
function canonicalPath(path: string) { const [pathname, query] = path.split('?'); const params = new URLSearchParams(query); params.sort(); return pathname + (params.size ? '?' + params : ''); }
export function apiResourceKey(path: string, options: ApiOptions = {}) {
  return JSON.stringify([options.auth === false ? 'public' : scope(), new Headers(options.headers).get('X-Locale') || activeLocale(), canonicalPath(path)]);
}
function ttlFor(path: string) {
  if (path.startsWith('/meta/')) return 600_000;
  if (path === '/profiles/me/matching-status') return 0;
  return /^\/(profiles\/me(?:\b|\/)|jobs(?:\b|\/)|applications(?:\b|\/)|alerts(?:\b|\/)|auth\/me$)/.test(path) ? 30_000 : 0;
}
export function peekApi<T>(path: string, options: ApiOptions = {}) {
  if (typeof window === 'undefined') return undefined;
  ensureCacheIdentity(); return resourceCache.peek<T>(apiResourceKey(path, options));
}
export function subscribeApi(path: string, options: ApiOptions, fn: () => void) { return resourceCache.subscribe(apiResourceKey(path, options), fn); }
export function invalidateApi(prefixes = ['/profiles/me', '/jobs', '/applications', '/alerts'], broadcast = true, actor = scope()) {
  resourceCache.invalidate(key => { const [owner, , path] = JSON.parse(key); return (owner === actor || owner === 'public') && prefixes.some(prefix => path.startsWith(prefix)); });
  if (typeof window !== 'undefined') {
    window.dispatchEvent?.(new CustomEvent('candidate-resource-changed', { detail: { prefixes, scope: actor } }));
    if (broadcast) cacheChannel?.postMessage({ type: 'invalidate', prefixes, scope: actor });
  }
}
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { cacheMode, ...networkOptions } = options;
  const method = (options.method || 'GET').toUpperCase();
  if (typeof window === 'undefined') return apiNetwork<T>(path, networkOptions);
  ensureCacheIdentity();
  const ttl = method === 'GET' && cacheMode !== 'no-store' ? ttlFor(path) : 0;
  if (ttl) {
    const actor=scope();
    const value=await resourceCache.read(apiResourceKey(path, options), signal => apiNetwork<T>(path, { ...networkOptions, signal }), ttl, options.signal || undefined, cacheMode === 'reload');
    if(options.auth!==false&&actor!==scope())throw new ApiError('Account changed. Please retry.',409);
    return value;
  }
  const value = await apiNetwork<T>(path, networkOptions);
  if (!['GET','HEAD'].includes(method) && /^\/(profiles|jobs|applications|alerts|admin\/(catalog|employee-matching|position-groups)|companies)/.test(path)) {
    invalidateApi(path.startsWith('/admin/') ? ['/meta/', '/jobs', '/profiles/me'] : undefined);
  }
  return value;
}

/** Multipart upload with upload progress and the same account/locale protections as api(). */
export async function apiUpload<T>(path: string, body: FormData, onProgress?: (percent: number) => void): Promise<T> {
  const actor = getSession()?.user.id;
  const send = (token: string | null) => new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_URL}/api${path}`);
    request.timeout = 120_000;
    request.setRequestHeader('X-Locale', activeLocale());
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => resolve({ status: request.status, text: request.responseText });
    request.onerror = () => reject(new ApiError('Network error while uploading files', 0));
    request.ontimeout = () => reject(new ApiError('File upload timed out', 408));
    request.onabort = () => reject(new ApiError('File upload was cancelled', 0));
    request.send(body);
  });
  const assertAccount = () => {
    if (actor !== getSession()?.user.id) throw new ApiError('Account changed. Please retry.', 409);
  };
  let response = await send(getToken());
  assertAccount();
  if (response.status === 401 && getToken()) {
    const rotated = await tryRefresh();
    assertAccount();
    if (rotated) response = await send(rotated);
  }
  assertAccount();
  let data: unknown = null;
  if (response.text) {
    try { data = JSON.parse(response.text); }
    catch { data = { message: response.text }; }
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(formatApiError(data, 'Upload failed'), response.status);
  }
  onProgress?.(100);
  invalidateApi();
  return data as T;
}

export async function apiBlob(path:string, options?: {headers?: HeadersInit; signal?: AbortSignal}):Promise<Blob> {
  const actor=getSession()?.user.id;
  const headers=new Headers(options?.headers);
  headers.set('X-Locale',activeLocale());
  if(getToken())headers.set('Authorization','Bearer '+getToken());
  let response=await fetch(API_URL+'/api'+path,{headers,cache:'no-store',signal:options?.signal});
  if(actor!==getSession()?.user.id)throw new ApiError('Account changed. Please retry.',409);
  if(response.status===401){const token=await tryRefresh();if(actor!==getSession()?.user.id)throw new ApiError('Account changed. Please retry.',409);if(token){headers.set('Authorization','Bearer '+token);response=await fetch(API_URL+'/api'+path,{headers,cache:'no-store',signal:options?.signal});}}
  if(actor!==getSession()?.user.id)throw new ApiError('Account changed. Please retry.',409);
  if(!response.ok){const body=await response.json().catch(()=>null);throw new ApiError(formatApiError(body,response.statusText),response.status);}
  const file=await response.blob();
  if(actor!==getSession()?.user.id)throw new ApiError('Account changed. Please retry.',409);
  return file;
}
