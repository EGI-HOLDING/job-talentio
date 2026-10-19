'use client';

import { AuthLink } from '@/components/auth/AuthLink';
import auth from '@/components/recruiter/EmployerAuth.module.css';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { FormAlert, FormField, PasswordInput } from '@/components/ui/Field';

function ResetPasswordInner() {
  const params = useSearchParams();
  const { t } = useI18n();
  const token = params.get('token') || '';
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const newPassword = String(fd.get('newPassword') || '');
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ token, newPassword }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ui.resetFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={'auth-wrap' + (params.get('role') === 'RECRUITER' ? ' ' + auth.page : '')}>
      <div className="auth-card">
        <h1>{t('ui.chooseNewPassword')}</h1>
        {!token && <><FormAlert>{t('ui.missingResetToken')}</FormAlert><p><AuthLink href="/forgot-password">{t('public.requestLink')}</AuthLink></p></>}
        {done ? (
          <>
            <FormAlert tone="success">{t('ui.passwordUpdatedSignIn')}</FormAlert>
            <p className="muted">
              <AuthLink href="/login" style={{ color: 'var(--accent)' }}>
                {t('signIn')}
              </AuthLink>
            </p>
          </>
        ) : token ? (
          <form className="form-stack" onSubmit={onSubmit}>
            <FormField label={t('newPassword')} required>
              <PasswordInput name="newPassword" required minLength={8} autoComplete="new-password" />
            </FormField>
            {error && <><FormAlert>{error}</FormAlert><p><AuthLink href="/forgot-password">{t('public.requestLink')}</AuthLink></p></>}
            <button type="submit" disabled={loading || !token}>
              {loading ? t('saving') : t('ui.updatePassword')}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
