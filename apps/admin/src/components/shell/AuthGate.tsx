'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api, clearToken, getToken, logout, saveToken } from '@/lib/api';
import { Alert } from '@/components/ui/primitives';

type Session = {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; email: string | null; fullName: string; role: string };
};

type AdminIdentity = { email: string; fullName: string };

function EyeIcon({ crossed }: { crossed?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {crossed ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

const IDENTITY_KEY = 'jt_admin_identity';

export function readIdentity(): AdminIdentity | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminIdentity;
  } catch {
    return null;
  }
}

export function signOut() {
  void logout().finally(() => {
    localStorage.removeItem(IDENTITY_KEY);
    window.location.href = '/';
  });
}

/**
 * Gates the whole console behind a super admin session. Rendering children only
 * after a token exists keeps every page free of auth branching.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        if (!cancelled) setReady(true);
        return;
      }
      try {
        const session = await api<Session>('/auth/me');
        if (cancelled) return;
        if (session.user.role !== 'SUPER_ADMIN') {
          clearToken();
          localStorage.removeItem(IDENTITY_KEY);
          setAuthed(false);
        } else {
          setAuthed(true);
        }
      } catch {
        if (!cancelled) {
          clearToken();
          localStorage.removeItem(IDENTITY_KEY);
          setAuthed(false);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const session = await api<Session>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: String(form.get('email') ?? '').trim(),
          password: form.get('password'),
        }),
      });
      if (session.user.role !== 'SUPER_ADMIN') {
        throw new Error('That account is not a super admin');
      }
      saveToken(session.accessToken, session.refreshToken);
      localStorage.setItem(
        IDENTITY_KEY,
        JSON.stringify({ email: session.user.email ?? '', fullName: session.user.fullName }),
      );
      setAuthed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  // Avoids a login flash before localStorage has been read.
  if (!ready) return null;

  if (authed) return <>{children}</>;

  return (
    <main className="login-wrap">
      <div className="login-card">
        <div className="sidebar-brand" style={{ padding: 0, marginBottom: '1rem' }}>
          <span className="sidebar-mark" aria-hidden>
            JT
          </span>
          <span>Job Talentio Admin</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Super admin access only.
        </p>
        <form onSubmit={login} noValidate style={{ display: 'grid', gap: '0.75rem' }}>
          <label>
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              spellCheck={false}
              autoFocus
            />
          </label>
          <label>
            Password
            <span className="pw-field">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                spellCheck={false}
              />
              <button
                type="button"
                className="pw-toggle"
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => setShowPassword((v) => !v)}
              >
                <EyeIcon crossed={showPassword} />
              </button>
            </span>
          </label>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <button type="submit" disabled={loading} aria-busy={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
