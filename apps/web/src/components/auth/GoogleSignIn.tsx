'use client';
import { authDestination, authRoleErrorKey, roleMismatchKey, type AuthRole } from '@/lib/authReturn';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ADMIN_URL, api, saveSession } from '@/lib/api';
import { FormAlert, FormField } from '@/components/ui/Field';
import { useI18n } from '@/lib/i18n';
import { localeHref } from '@/lib/navigation';
import { loadAuthSdk } from '@/lib/authSdk';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let initializedClientId = '';
let credentialHandler: ((credential: string) => void) | null = null;

type GoogleResponse =
 | { requiresVerification: true; email: string }
 | { requiresRegistration: true; email: string; fullName: string }
 | { accessToken: string; joinedCompanyId?: string; user: { role: string; locale?: string } };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (res: { credential: string }) => void;
          }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

function redirectAfterLogin(role: string, companyId?: string) {
  if (role === 'RECRUITER') return '/dashboard/recruiter?tab=jobs' + (companyId ? `&company=${encodeURIComponent(companyId)}` : '');
  if (role === 'SUPER_ADMIN') return ADMIN_URL;
  return '/jobs?mode=for-you';
}

/**
 * "Continue with Google" flow (GIS ID token):
 * button → /auth/oauth/google → role picker for new users → session issued immediately.
 * Keep this entry point visible, including when a local provider is not configured.
 */
export function GoogleSignIn({
  inviteToken,
  accountRole,
  showWhenUnavailable = false,
  autoCreateEmployeeOnFirstSignIn = false,
}: {
  inviteToken?: string;
  accountRole?: AuthRole;
  showWhenUnavailable?: boolean;
  autoCreateEmployeeOnFirstSignIn?: boolean;
} = {}) {
  const { t, locale } = useI18n();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [needsRole, setNeedsRole] = useState<{ email: string; fullName: string } | null>(null);
  const [role, setRole] = useState<AuthRole>(accountRole || 'EMPLOYEE');
  const [companyName, setCompanyName] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<'loading' | 'ready' | 'unavailable' | 'failed'>('loading');
  const [providerRetry, setProviderRetry] = useState(0);

  const submitGoogle = useCallback(
    async (token: string, chosenRole?: 'EMPLOYEE' | 'RECRUITER', company?: string) => {
      setBusy(true);
      setError('');
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 25_000);
      try {
        const res = await api<GoogleResponse>('/auth/oauth/google', {
          method: 'POST',
          auth: false,
          signal: controller.signal,
          body: JSON.stringify({
            idToken: token,
            role: chosenRole,
            expectedRole: accountRole,
            companyName: chosenRole === 'RECRUITER' && !inviteToken ? company : undefined,
            locale,
            inviteToken: inviteToken || undefined,
          }),
        });
        if ('requiresVerification' in res) {
          setNeedsRole(null);
          setPendingEmail(res.email);
          return;
        }
        if ('requiresRegistration' in res) {
          setNeedsRole({ email: res.email, fullName: res.fullName });
          return;
        }
        const mismatch = accountRole && roleMismatchKey(res.user.role, accountRole);
        if (mismatch && !inviteToken) { setError(t(mismatch)); return; }
        saveSession(res as Parameters<typeof saveSession>[0]);
        window.location.href = localeHref(authDestination(redirectAfterLogin(res.user.role, res.joinedCompanyId)));
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        setError(
          aborted
            ? t('authProvider.timeout')
            : (authRoleErrorKey((err as Error).message) ? t(authRoleErrorKey((err as Error).message)!) : (err as Error).message) || 'Google sign-in failed',
        );
      } finally {
        window.clearTimeout(timer);
        setBusy(false);
      }
    },
    [locale, inviteToken, accountRole, t],
  );

  // GIS callback must always see the latest submitGoogle without re-initializing GIS
  const submitRef = useRef(submitGoogle);
  useEffect(() => {
    submitRef.current = submitGoogle;
  }, [submitGoogle]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    const handle = (credential: string) => {
      if (!alive) return;
      setIdToken(credential);
      void submitRef.current(credential, autoCreateEmployeeOnFirstSignIn && accountRole === 'EMPLOYEE' ? 'EMPLOYEE' : undefined);
    };
    setProvider('loading');
    void (async () => {
      try {
        const config = await api<{ available: boolean; clientId?: string }>('/auth/google/config', { auth: false, signal: controller.signal });
        window.clearTimeout(timer);
        if (!alive) return;
        if (!config.available || !config.clientId) { setProvider('unavailable'); return; }
        await loadAuthSdk(GIS_SRC, () => Boolean(window.google?.accounts.id));
        if (!alive || !buttonRef.current || !window.google) return;
        credentialHandler = handle;
        if (initializedClientId !== config.clientId) {
          window.google.accounts.id.initialize({ client_id: config.clientId, callback: (response) => credentialHandler?.(response.credential) });
          initializedClientId = config.clientId;
        }
        const element = buttonRef.current;
        element.replaceChildren();
        window.google.accounts.id.renderButton(element, {
          theme: 'outline', size: 'large', width: Math.min(400, Math.max(200, element.parentElement?.clientWidth || 280)),
          text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', locale,
        });
        setProvider('ready');
      } catch { if (alive) setProvider('failed'); }
      finally { window.clearTimeout(timer); }
    })();
    return () => { alive = false; controller.abort(); window.clearTimeout(timer); if (credentialHandler === handle) credentialHandler = null; };
  }, [locale, providerRetry, autoCreateEmployeeOnFirstSignIn, accountRole]);

  if (provider === 'unavailable' && !showWhenUnavailable) return null;

  async function resend() {
    if (!pendingEmail) return;
    try {
      await api('/auth/resend-verification', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email: pendingEmail }),
      });
      setResent(true);
    } catch {
      setResent(true);
    }
  }

  if (pendingEmail) {
    return (
      <div className="google-signin">
        <div className="google-verify-card">
          <strong>{t('verifyEmailTitle')}</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0.75rem', fontSize: '0.9rem' }}>
            {t('verifyEmailSentTo')} <strong>{pendingEmail}</strong>.{' '}
            {t('verifyEmailInstruction')}
          </p>
          <button type="button" className="chip" onClick={resend} disabled={resent}>
            {resent ? t('verifyEmailResent') : t('verifyEmailResend')}
          </button>
        </div>
      </div>
    );
  }

  if (needsRole && idToken) {
    return (
      <div className="google-signin">
        <div className="google-verify-card">
          <strong>{t(accountRole ? accountRole === 'RECRUITER' ? 'authRole.employerRegister' : 'authRole.employeeRegister' : 'googleChooseRole')}</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0.75rem', fontSize: '0.9rem' }}>
            {needsRole.fullName} | {needsRole.email}
          </p>
          {inviteToken || accountRole ? null : (
          <div className="chips" role="radiogroup" style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              role="radio"
              aria-checked={role === 'EMPLOYEE'}
              className={`chip ${role === 'EMPLOYEE' ? 'active' : ''}`}
              onClick={() => setRole('EMPLOYEE')}
            >
              {t('imCandidate')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={role === 'RECRUITER'}
              className={`chip ${role === 'RECRUITER' ? 'active' : ''}`}
              onClick={() => setRole('RECRUITER')}
            >
              {t('imHiring')}
            </button>
          </div>
          )}
          {role === 'RECRUITER' && !inviteToken && (
            <FormField label={t('companyName')} required>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                minLength={2}
                required
              />
            </FormField>
          )}
          <FormAlert>{error}</FormAlert>
          <button
            type="button"
            disabled={
              busy ||
              (!inviteToken && role === 'RECRUITER' && companyName.trim().length < 2)
            }
            onClick={() =>
              submitGoogle(idToken, inviteToken ? 'RECRUITER' : role, companyName.trim())
            }
            style={{ marginTop: '0.5rem' }}
          >
            {busy ? t('creatingAccount') : t('continueLabel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="google-signin">
      <div className="auth-divider">
        <span>{t('orContinueWith')}</span>
      </div>
      <div className="google-btn-slot">
        <div ref={buttonRef} className="auth-social-gis" aria-hidden={provider !== 'ready'} aria-busy={busy} inert={busy} style={{ display: provider === 'ready' ? undefined : 'none' }} />
        {provider !== 'ready' && <button
          type="button"
          className="auth-social-btn auth-social-btn--google"
          disabled={busy || provider !== 'failed'}
          onClick={() => setProviderRetry(value => value + 1)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.71A5.41 5.41 0 0 1 3.69 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96L3.97 7.3C4.68 5.16 6.66 3.58 9 3.58z"
            />
          </svg>
          {provider === 'failed' ? t('workspace.retry') : t('googleContinue')}
        </button>}
      </div>
      {busy && provider === 'ready' && <p className="auth-provider-feedback" role="status">{t('signingIn')}</p>}
      {provider !== 'ready' && <p className="auth-provider-feedback" role={provider === 'failed' ? 'alert' : 'status'}>{t(provider === 'loading' ? 'authProvider.loading' : provider === 'failed' ? 'authProvider.loadFailed' : 'authProvider.unavailable')}</p>}
      <FormAlert>{error}</FormAlert>
    </div>
  );
}
