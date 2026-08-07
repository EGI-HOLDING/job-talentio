'use client';

import Link from 'next/link';
import { FormEvent, useId, useState } from 'react';
import { api, saveSession } from '@/lib/api';
import { FormAlert, FormField, PasswordInput } from '@/components/ui/Field';
import { GoogleSignIn } from '@/components/auth/GoogleSignIn';
import { useI18n } from '@/lib/i18n';

export default function RegisterPage() {
  const { t, locale } = useI18n();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<'EMPLOYEE' | 'RECRUITER'>('EMPLOYEE');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const formHintId = useId();
  const roleGroupId = useId();
  const termsId = useId();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const fullName = String(fd.get('fullName') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    const confirmPassword = String(fd.get('confirmPassword') ?? '');
    const companyName = String(fd.get('companyName') ?? '').trim();

    if (!fullName || !email || !password) {
      setError(t('authFillRequired'));
      return;
    }
    if (password.length < 8) {
      setError(t('passwordHint'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'));
      return;
    }
    if (role === 'RECRUITER' && companyName.length < 2) {
      setError(t('companyNameRequired'));
      return;
    }
    if (!acceptTerms) {
      setError(t('mustAcceptTerms'));
      return;
    }

    setLoading(true);
    try {
      const session = await api<{ accessToken: string; user: { role: string } }>('/auth/register', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          email,
          password,
          fullName,
          role,
          locale,
          acceptTerms: true,
          companyName: role === 'RECRUITER' ? companyName : undefined,
        }),
      });
      saveSession(session as Parameters<typeof saveSession>[0]);
      window.location.href =
        session.user.role === 'RECRUITER' ? '/dashboard/recruiter' : '/dashboard/employee';
    } catch (err) {
      setError((err as Error).message || t('authRegisterFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{t('createAccount')}</h1>
        <p className="muted">{t('joinTalentio')}</p>
        <div
          className="chips"
          style={{ marginTop: '1rem' }}
          role="radiogroup"
          aria-labelledby={roleGroupId}
        >
          <p id={roleGroupId} className="sr-only">
            {t('accountType')}
          </p>
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
        <p id={formHintId} className="required-note">
          {t('requiredFieldsNote')}
        </p>
        <form className="form-stack" onSubmit={onSubmit} aria-describedby={formHintId} noValidate>
          <FormField label={t('fullName')} required>
            <input name="fullName" autoComplete="name" minLength={2} required />
          </FormField>
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
          <FormField label={t('password')} required hint={t('passwordHint')}>
            <PasswordInput name="password" autoComplete="new-password" minLength={8} required />
          </FormField>
          <FormField label={t('confirmPassword')} required>
            <PasswordInput
              name="confirmPassword"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </FormField>
          {role === 'RECRUITER' && (
            <FormField label={t('companyName')} required>
              <input name="companyName" autoComplete="organization" minLength={2} required />
            </FormField>
          )}
          <label className="auth-terms" htmlFor={termsId}>
            <input
              id={termsId}
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              aria-required="true"
            />
            <span>
              {t('acceptTermsLabel')}
              <abbr className="field-req" title={t('required')}>
                *
              </abbr>
            </span>
          </label>
          <FormAlert>{error}</FormAlert>
          <button type="submit" className="cta" disabled={loading} aria-busy={loading}>
            {loading ? t('creatingAccount') : t('createAccount')}
          </button>
        </form>
        <GoogleSignIn />
        <p className="muted" style={{ marginTop: '1.25rem', fontSize: '0.9rem' }}>
          {t('alreadyRegistered')}{' '}
          <Link href="/login" style={{ color: 'var(--accent)' }}>
            {t('login')}
          </Link>
        </p>
      </div>
    </div>
  );
}
