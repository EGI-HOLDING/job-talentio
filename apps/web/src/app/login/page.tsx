'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, saveSession } from '@/lib/api';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      window.location.href =
        session.user.role === 'RECRUITER' ? '/dashboard/recruiter' : '/dashboard/employee';
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Welcome back</h1>
        <p className="muted">Sign in to Job Talentio</p>
        <form className="form-stack" onSubmit={onSubmit}>
          <label>
            Email
            <input name="email" type="email" required defaultValue="employee@demo.uz" />
          </label>
          <label>
            Password
            <input name="password" type="password" required defaultValue="Password123!" />
          </label>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div style={{ marginTop: '1.25rem' }}>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Local quick login
          </p>
          <div className="chips" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="chip" onClick={() => quick('employee@demo.uz')}>
              Employee
            </button>
            <button type="button" className="chip" onClick={() => quick('recruiter@demo.uz')}>
              Recruiter
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: '1.25rem', fontSize: '0.9rem' }}>
          No account? <Link href="/register" style={{ color: 'var(--accent)' }}>Register</Link>
        </p>
      </div>
    </div>
  );
}
