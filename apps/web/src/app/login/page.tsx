'use client';

import Link from 'next/link';
import { FormEvent, useId, useState } from 'react';
import { api, saveSession } from '@/lib/api';
import { FormAlert, FormField } from '@/components/ui/Field';
import { useI18n } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';

export default function LoginPage() {
  const { t, setLocale } = useI18n();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const formHintId = useId();

  function applySessionLocale(session: { user?: { locale?: string } }) {
    const loc = session.user?.locale;
    if (loc === 'uz' || loc === 'ru' || loc === 'en') setLocale(loc as Locale);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const session = await api<any>('/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          email: fd.get('email'),
          password: fd.get('password'),
        }),
      });
      saveSession(session);
      applySessionLocale(session);
      const role = session.user.role;
      window.location.href =
        role === 'RECRUITER'
          ? '/dashboard/recruiter'
          : role === 'SUPER_ADMIN'
            ? 'http://localhost:3001'
            : '/dashboard/employee';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function quick(email: string) {
    setError('');
    try {
      const session = await api<any>('/auth/dev-login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email }),
      });
      saveSession(session);
      applySessionLocale(session);
      window.location.href =
        session.user.role === 'RECRUITER' ? '/dashboard/recruiter' : '/dashboard/employee';
    } catch (err) {
      setError((err as Error).message);
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
        <form className="form-stack" onSubmit={onSubmit} aria-describedby={formHintId}>
          <FormField label={t('email')} required>
            <input name="email" type="email" autoComplete="email" defaultValue="madina.karimova@gmail.com" />
          </FormField>
          <FormField label={t('password')} required>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              defaultValue="Password123!"
            />
          </FormField>
          <FormAlert>{error}</FormAlert>
          <button type="submit" disabled={loading}>
            {loading ? t('signingIn') : t('signIn')}
          </button>
        </form>
        <div style={{ marginTop: '1.25rem' }}>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            {t('localQuickLogin')}
          </p>
          <div className="chips" style={{ marginTop: '0.5rem' }} role="group" aria-label={t('localQuickLogin')}>
            <button type="button" className="chip" onClick={() => quick('madina.karimova@gmail.com')}>
              {t('employee')}
            </button>
            <button type="button" className="chip" onClick={() => quick('jasur.tursunov@apexsoft.uz')}>
              {t('recruiter')}
            </button>
          </div>
        </div>
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
