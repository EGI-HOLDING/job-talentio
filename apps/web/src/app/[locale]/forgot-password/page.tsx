'use client';

import { Link } from '@/lib/navigation';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { FormAlert, FormField } from '@/components/ui/Field';

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setMsg('');
    setLoading(true);
    const email = String(new FormData(e.currentTarget).get('email') || '').trim();
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email }),
      });
      setMsg(t('ui.forgotPasswordSent'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ui.requestFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{t('ui.forgotPassword')}</h1>
        <p className="muted">{t('ui.forgotPasswordHint')}</p>
        <form className="form-stack" onSubmit={onSubmit}>
          <FormField label={t('email')} required>
            <input name="email" type="email" required autoComplete="email" />
          </FormField>
          {error && <FormAlert>{error}</FormAlert>}
          {msg && <FormAlert tone="success">{msg}</FormAlert>}
          <button type="submit" disabled={loading}>
            {loading ? t('verifyEmailSending') : t('ui.sendResetLink')}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          <Link href="/login" style={{ color: 'var(--accent)' }}>
            {t('ui.backToSignIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
