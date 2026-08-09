const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001';

export type AuthSession = {
  accessToken: string;
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
  localStorage.setItem('jt_session', JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem('jt_token');
  localStorage.removeItem('jt_session');
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
  if (options.auth !== false) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
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
    // #region agent log
    if (path.includes('/resumes/upload') || path.includes('/resumes/') && path.endsWith('/file')) {
      fetch('http://127.0.0.1:7812/ingest/fd53d647-d921-425f-858e-3b9eba28cb0d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'58b1d6'},body:JSON.stringify({sessionId:'58b1d6',runId:'pre-fix',hypothesisId:'A',location:'api.ts:resumeUploadFail',message:'resume upload HTTP error',data:{path,status:res.status,bodyPreview:text.slice(0,400),apiHost:API_URL.replace(/https?:\/\//,'').slice(0,40)},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    throw new Error(formatApiError(data, res.statusText || 'Request failed'));
  }
  return data as T;
}
