'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ADMIN_URL, api, saveSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function redirectAfterLogin(role: string) {
  if (role === 'RECRUITER') return '/';
  if (role === 'SUPER_ADMIN') return ADMIN_URL;
  return '/dashboard/employee';
}

function VerifyEmailInner() {
  const params = useSearchParams();
  const { t } = useI18n();
  const [state, setState] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');
  const ranRef = useRef(false);

  useEffect(() => {
    // Guard against React strict-mode double invoke: token is single-use
    if (ranRef.current) return;
    ranRef.current = true;

    const token = params.get('token');
    if (!token) {
      setState('error');
      setMessage(t('verifyEmailFailed'));
      return;
    }
    (async () => {
      try {
        const session = await api<{ accessToken: string; user: { role: string } }>(
          '/auth/verify-email',
          {
            method: 'POST',
            auth: false,
            body: JSON.stringify({ token }),
          },
        );
        saveSession(session as Parameters<typeof saveSession>[0]);
        setState('success');
        setTimeout(() => {
          window.location.href = redirectAfterLogin(session.user.role);
        }, 1200);
      } catch (err) {
        setState('error');
        setMessage((err as Error).message || t('verifyEmailFailed'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h1>{t('verifyEmailTitle')}</h1>
        {state === 'verifying' && <p className="muted">{t('verifying')}</p>}
        {state === 'success' && (
          <p style={{ color: '#047857', fontWeight: 600 }}>{t('verifyEmailSuccess')}</p>
        )}
        {state === 'error' && (
          <>
            <p style={{ color: '#be123c' }}>{message || t('verifyEmailFailed')}</p>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              <Link href="/dashboard/employee" style={{ color: 'var(--accent)' }}>
                {t('dashboard')}
              </Link>{' '}
              - open Profile and request a new verification email.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
