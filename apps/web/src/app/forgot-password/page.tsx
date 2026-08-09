'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { FormAlert, FormField } from '@/components/ui/Field';

export default function ForgotPasswordPage() {
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
      setMsg('If that email is registered, we sent a reset link. Check your inbox.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Forgot password</h1>
        <p className="muted">Enter your account email and we will send a reset link.</p>
        <form className="form-stack" onSubmit={onSubmit}>
          <FormField label="Email" required>
            <input name="email" type="email" required autoComplete="email" />
          </FormField>
          {error && <FormAlert>{error}</FormAlert>}
          {msg && <FormAlert tone="success">{msg}</FormAlert>}
          <button type="submit" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          <Link href="/login" style={{ color: 'var(--accent)' }}>
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
