'use client';
import { AuthLink, AuthReturnNotice } from '@/components/auth/AuthLink';
import { authDestination, authRoleFrom, authRoleErrorKey, roleMismatchKey } from '@/lib/authReturn';

import { localeUrl } from '@/lib/navigation';
import { FormEvent, Suspense, useEffect, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ADMIN_URL, api, saveSession } from '@/lib/api';
import { FormAlert, FormField, PasswordInput } from '@/components/ui/Field';
import { GoogleSignIn } from '@/components/auth/GoogleSignIn';
import { TelegramSignIn } from '@/components/auth/TelegramSignIn';
import { PhoneSignIn } from '@/components/auth/PhoneSignIn';
import employerAuth from '@/components/recruiter/EmployerAuth.module.css';
import { useI18n } from '@/lib/i18n';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from '@/lib/locale';
import type { Locale } from '@/lib/locale';

function redirectAfterLogin(role: string, companyId?: string) {
  if (role === 'RECRUITER') return '/dashboard/recruiter?tab=jobs' + (companyId ? `&company=${encodeURIComponent(companyId)}` : '');
  if (role === 'SUPER_ADMIN') return ADMIN_URL;
  return '/jobs?mode=for-you';
}

function LoginForm() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite')?.trim() || undefined;
  const role = inviteToken ? 'RECRUITER' : authRoleFrom(searchParams.get('role'));
  const employer = role === 'RECRUITER';
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const formHintId = useId();

  useEffect(() => { setError(''); }, [role]);

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
      const session = await api<{ accessToken: string; joinedCompanyId?: string; user: { role: string; locale?: string } }>(
        '/auth/login',
        {
          method: 'POST',
          auth: false,
          body: JSON.stringify({ email, password, expectedRole: role, inviteToken }),
        },
      );
      const mismatch = roleMismatchKey(session.user.role, role);
      if (mismatch) { setError(t(mismatch)); return; }
      saveSession(session as Parameters<typeof saveSession>[0]);
      window.location.href = localeUrl(
        sessionLocale(session),
        authDestination(redirectAfterLogin(session.user.role, session.joinedCompanyId)),
      );
    } catch (err) {
      const message = (err as Error).message || t('authLoginFailed');
      const roleError = authRoleErrorKey(message);
      setError(roleError ? t(roleError) : message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={"auth-wrap" + (employer ? " " + employerAuth.page : "")}>
      <div className="auth-card">
        <h1>{t(employer ? 'employers.login' : 'authRole.employeeLogin')}</h1>
        <p className="muted">{t(employer ? 'authRole.employerSub' : 'authRole.employeeSub')}</p>
        <AuthReturnNotice />
        {inviteToken ? <p className="muted">{t('inviteExistingLogin')}</p> : null}
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
            <AuthLink href="/forgot-password" style={{ color: 'var(--accent)' }}>
              {t('ui.forgotPassword')}?
            </AuthLink>
          </p>
          <FormAlert>{error}</FormAlert>
          <button type="submit" disabled={loading} aria-busy={loading}>
            {loading ? t('signingIn') : t('signIn')}
          </button>
        </form>
        <GoogleSignIn
          key={`google-${role}`}
          accountRole={role}
          inviteToken={inviteToken}
          showWhenUnavailable
          autoCreateEmployeeOnFirstSignIn={!employer}
        />
        <TelegramSignIn
          key={`telegram-${role}`}
          accountRole={role}
          inviteToken={inviteToken}
          showWhenUnavailable
          autoCreateEmployeeOnFirstSignIn={!employer}
        />
        <PhoneSignIn key={`phone-${role}`} accountRole={role} showWhenUnavailable />
        <p className="muted" style={{ marginTop: '1.25rem', fontSize: '0.9rem' }}>
          {t('noAccount')}{' '}
          <AuthLink href="/register" accountRole={role} style={{ color: 'var(--accent)' }}>
            {t('register')}
          </AuthLink>
        </p>
        <p className="muted" style={{ fontSize: '.8rem' }}><AuthLink href="/login" accountRole={employer ? 'EMPLOYEE' : 'RECRUITER'} next={null}>{t(employer ? 'authRole.asEmployee' : 'authRole.asEmployer')}</AuthLink></p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
