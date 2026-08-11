'use client';

import { Link, localeUrl } from '@/lib/navigation';
import { FormEvent, useId, useState } from 'react';
import { ADMIN_URL, api, saveSession } from '@/lib/api';
import { FormAlert, FormField, PasswordInput } from '@/components/ui/Field';
import { GoogleSignIn } from '@/components/auth/GoogleSignIn';
import { useI18n } from '@/lib/i18n';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from '@/lib/locale';
import type { Locale } from '@/lib/locale';

function redirectAfterLogin(role: string) {
  if (role === 'RECRUITER') return '/';
  if (role === 'SUPER_ADMIN') return ADMIN_URL;
  return '/dashboard/employee';
}

export default function LoginPage() {
  const { t, locale } = useI18n();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const formHintId = useId();

  /** Land on the language saved on the account, not the one used to sign in. */
  function sessionLocale(session: { user?: { locale?: string } }): Locale {
    const preferred = session.user?.locale;
    if (!isLocale(preferred)) return locale;
    document.cookie = `${LOCALE_COOKIE}=${preferred}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    return preferred;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    if (!email || !password) {
      setError(t('authFillRequired'));
      setLoading(false);
      return;
    }
    try {
      const session = await api<{ accessToken: string; user: { role: string; locale?: string } }>(
        '/auth/login',
        {
          method: 'POST',
          auth: false,
          body: JSON.stringify({ email, password }),
        },
      );
      saveSession(session as Parameters<typeof saveSession>[0]);
      window.location.href = localeUrl(
        sessionLocale(session),
        redirectAfterLogin(session.user.role),
      );
    } catch (err) {
      setError((err as Error).message || t('authLoginFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{t('welcomeBack')}</h1>
        <p className="muted">{t('signInTo')}</p>
        <p id={formHintId} className="required-note">
          {t('requiredFieldsNote')}
        </p>
        <form className="form-stack" onSubmit={onSubmit} aria-describedby={formHintId} noValidate>
          <FormField label={t('email')} required>
            <input
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              spellCheck={false}
            />
          </FormField>
          <FormField label={t('password')} required>
            <PasswordInput name="password" autoComplete="current-password" required />
          </FormField>
          <p style={{ margin: '-0.35rem 0 0', fontSize: '0.88rem' }}>
            <Link href="/forgot-password" style={{ color: 'var(--accent)' }}>
              {t('ui.forgotPassword')}?
            </Link>
          </p>
          <FormAlert>{error}</FormAlert>
          <button type="submit" disabled={loading} aria-busy={loading}>
            {loading ? t('signingIn') : t('signIn')}
          </button>
        </form>
        <GoogleSignIn />
        <p className="muted" style={{ marginTop: '1.25rem', fontSize: '0.9rem' }}>
          {t('noAccount')}{' '}
          <Link href="/register" style={{ color: 'var(--accent)' }}>
            {t('register')}
          </Link>
        </p>
      </div>
    </div>
  );
}
