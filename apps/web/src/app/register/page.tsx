'use client';

import Link from 'next/link';
import { FormEvent, useId, useState } from 'react';
import { api, saveSession } from '@/lib/api';
import { FormAlert, FormField } from '@/components/ui/Field';
import { useI18n } from '@/lib/i18n';

export default function RegisterPage() {
  const { t, locale } = useI18n();
  const [error, setError] = useState('');
  const [role, setRole] = useState<'EMPLOYEE' | 'RECRUITER'>('EMPLOYEE');
  const formHintId = useId();
  const roleGroupId = useId();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      const session = await api<any>('/auth/register', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          email: fd.get('email'),
          password: fd.get('password'),
          fullName: fd.get('fullName'),
          role,
          locale,
          acceptTerms: true,
          companyName: role === 'RECRUITER' ? fd.get('companyName') : undefined,
        }),
      });
      saveSession(session);
      window.location.href = role === 'RECRUITER' ? '/dashboard/recruiter' : '/dashboard/employee';
    } catch (err) {
      setError((err as Error).message);
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
        <form className="form-stack" onSubmit={onSubmit} aria-describedby={formHintId}>
          <FormField label={t('fullName')} required>
            <input name="fullName" autoComplete="name" minLength={2} />
          </FormField>
          <FormField label={t('email')} required>
            <input name="email" type="email" autoComplete="email" />
          </FormField>
          <FormField label={t('password')} required hint={t('passwordHint')}>
            <input name="password" type="password" autoComplete="new-password" minLength={8} />
          </FormField>
          {role === 'RECRUITER' && (
            <FormField label={t('companyName')} required>
              <input name="companyName" autoComplete="organization" minLength={2} />
            </FormField>
          )}
          <FormAlert>{error}</FormAlert>
          <button type="submit" className="cta">
            {t('createAccount')}
          </button>
        </form>
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
