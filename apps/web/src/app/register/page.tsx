'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, saveSession } from '@/lib/api';

export default function RegisterPage() {
  const [error, setError] = useState('');
  const [role, setRole] = useState<'EMPLOYEE' | 'RECRUITER'>('EMPLOYEE');

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
          locale: 'uz',
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
        <h1>Create account</h1>
        <p className="muted">Join Job Talentio</p>
        <div className="chips" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className={`chip ${role === 'EMPLOYEE' ? 'active' : ''}`}
            onClick={() => setRole('EMPLOYEE')}
          >
            I&apos;m a candidate
          </button>
          <button
            type="button"
            className={`chip ${role === 'RECRUITER' ? 'active' : ''}`}
            onClick={() => setRole('RECRUITER')}
          >
            I&apos;m hiring
          </button>
        </div>
        <form className="form-stack" onSubmit={onSubmit}>
          <label>
            Full name
            <input name="fullName" required minLength={2} />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" required minLength={8} />
          </label>
          {role === 'RECRUITER' && (
            <label>
              Company name
              <input name="companyName" required minLength={2} />
            </label>
          )}
          {error && <div className="error">{error}</div>}
          <button type="submit" className="cta">
            Create account
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1.25rem', fontSize: '0.9rem' }}>
          Already registered? <Link href="/login" style={{ color: 'var(--accent)' }}>Login</Link>
        </p>
      </div>
    </div>
  );
}
