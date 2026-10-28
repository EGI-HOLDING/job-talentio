const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const ADMIN_SESSION_EXPIRED_EVENT = 'jt-admin-session-expired';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jt_admin_token');
}

export function saveToken(token: string, refreshToken?: string) {
  localStorage.setItem('jt_admin_token', token);
  if (refreshToken) {
    localStorage.setItem('jt_admin_refresh', refreshToken);
  }
}

export function clearToken() {
  localStorage.removeItem('jt_admin_token');
  localStorage.removeItem('jt_admin_refresh');
}

function expireSession() {
  clearToken();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT));
  }
}

/** Revoke the refresh family server-side (best effort), then clear local tokens. */
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
  clearToken();
}

function getRefreshToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jt_admin_refresh');
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
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            clearToken();
            return null;
          }
          const body: unknown = await res.json().catch(() => null);
          throw new ApiError(formatApiError(body, res.statusText || 'Session refresh failed'), res.status);
        }
        const session = (await res.json()) as { accessToken: string; refreshToken?: string };
        saveToken(session.accessToken, session.refreshToken);
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

export type ListEnvelope<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type MatchingIds = { ids: string[]; total: number; capped: boolean };

export type BulkResult = {
  requested: number;
  applied: number;
  skipped: Array<{ id: string; reason: string }>;
};

export type QueryValue = string | number | boolean | undefined | null;

/** Empty values are dropped so a cleared filter disappears from the URL. */
export function toQueryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function apiList<T>(path: string, params: Record<string, QueryValue>) {
  return api<ListEnvelope<T>>(`${path}${toQueryString(params)}`);
}

export function apiPost<T>(path: string, body?: unknown) {
  return api<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function apiPatch<T>(path: string, body: unknown) {
  return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function api<T>(path: string, options: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const { auth = true, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  headers.set('Content-Type', 'application/json');
  const token = auth ? getToken() : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let res = await fetch(`${API_URL}/api${path}`, { ...requestOptions, headers });

  // Expired access token: silently rotate once via the refresh token, then retry.
  if (res.status === 401 && token && path !== '/auth/refresh') {
    const rotated = await tryRefresh();
    if (rotated) {
      headers.set('Authorization', `Bearer ${rotated}`);
      res = await fetch(`${API_URL}/api${path}`, { ...requestOptions, headers });
    }
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) expireSession();
  if (!res.ok) throw new ApiError(formatApiError(data, res.statusText || 'Request failed'), res.status);
  return data as T;
}
