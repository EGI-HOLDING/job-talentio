'use client';

import { Link } from '@/lib/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { FormAlert, FormField, PasswordInput } from '@/components/ui/Field';

function ResetPasswordInner() {
  const params = useSearchParams();
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
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Choose a new password</h1>
        {!token && <FormAlert>Missing reset token. Request a new link.</FormAlert>}
        {done ? (
          <>
            <FormAlert tone="success">Password updated. You can sign in now.</FormAlert>
            <p className="muted">
              <Link href="/login" style={{ color: 'var(--accent)' }}>
                Sign in
              </Link>
            </p>
          </>
        ) : (
          <form className="form-stack" onSubmit={onSubmit}>
            <FormField label="New password" required>
              <PasswordInput name="newPassword" required minLength={8} autoComplete="new-password" />
            </FormField>
            {error && <FormAlert>{error}</FormAlert>}
            <button type="submit" disabled={loading || !token}>
              {loading ? 'Saving...' : 'Update password'}
            </button>
          </form>
        )}
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
