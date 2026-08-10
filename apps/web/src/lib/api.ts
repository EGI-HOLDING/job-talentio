import { DEFAULT_LOCALE, localeFromPathname } from '@/lib/locale';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001';

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
    email: string;
    fullName: string;
    role: string;
    locale?: string;
    avatarUrl?: string | null;
    emailVerified?: boolean;
    memberships?: Array<{ companyId: string; role: string }>;
    employeeProfileId?: string | null;
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
}

export function clearSession() {
  localStorage.removeItem('jt_token');
  localStorage.removeItem('jt_refresh');
  localStorage.removeItem('jt_session');
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
        if (!res.ok) return null;
        const session = (await res.json()) as AuthSession;
        saveSession(session);
        return session.accessToken;
      } catch {
        return null;
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
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('X-Locale')) headers.set('X-Locale', activeLocale());
  const useAuth = options.auth !== false;
  if (useAuth) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  let res = await fetch(`${API_URL}/api${path}`, { ...options, headers });

  // Expired access token: silently rotate once via the refresh token, then retry.
  if (res.status === 401 && useAuth && getToken() && !path.startsWith('/auth/')) {
    const rotated = await tryRefresh();
    if (rotated) {
      headers.set('Authorization', `Bearer ${rotated}`);
      res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
    } else if (getRefreshToken()) {
      // Refresh token present but rejected - session is unrecoverable.
      clearSession();
    }
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    throw new Error(formatApiError(data, res.statusText || 'Request failed'));
  }
  return data as T;
}
