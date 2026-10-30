import { DEFAULT_LOCALE, localeFromPathname } from '@/lib/locale';

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
  window.dispatchEvent?.(new Event('jt-session-updated'));
}

export function clearSession() {
  localStorage.removeItem('jt_token');
  localStorage.removeItem('jt_refresh');
  localStorage.removeItem('jt_session');
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

export async function api<T>(
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
  const actor = getSession()?.user.id;
  if (useAuth) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  let res = await fetch(`${API_URL}/api${path}`, { ...requestOptions, headers });
  if (useAuth && actor !== getSession()?.user.id) throw new ApiError('Account changed. Please retry.', 409);

  // Expired access token: silently rotate once via the refresh token, then retry.
  if (res.status === 401 && useAuth && getToken() && path !== '/auth/refresh') {
    const rotated = await tryRefresh();
    if (actor !== getSession()?.user.id) throw new ApiError('Account changed. Please retry.', 409);
    if (rotated) {
      headers.set('Authorization', `Bearer ${rotated}`);
      res = await fetch(`${API_URL}/api${path}`, { ...requestOptions, headers });
    }
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
  return data as T;
}

export async function apiBlob(path:string):Promise<Blob> {
  const actor=getSession()?.user.id;
  const headers=new Headers({'X-Locale':activeLocale()});
  if(getToken())headers.set('Authorization','Bearer '+getToken());
  let response=await fetch(API_URL+'/api'+path,{headers,cache:'no-store'});
  if(actor!==getSession()?.user.id)throw new ApiError('Account changed. Please retry.',409);
  if(response.status===401){const token=await tryRefresh();if(actor!==getSession()?.user.id)throw new ApiError('Account changed. Please retry.',409);if(token){headers.set('Authorization','Bearer '+token);response=await fetch(API_URL+'/api'+path,{headers,cache:'no-store'});}}
  if(actor!==getSession()?.user.id)throw new ApiError('Account changed. Please retry.',409);
  if(!response.ok){const body=await response.json().catch(()=>null);throw new ApiError(formatApiError(body,response.statusText),response.status);}
  const file=await response.blob();
  if(actor!==getSession()?.user.id)throw new ApiError('Account changed. Please retry.',409);
  return file;
}
