'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, saveSession } from '@/lib/api';

function ConfirmEmailChangeInner() {
  const params = useSearchParams();
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get('token');
    if (!token) {
      setState('error');
      setMessage('Missing confirmation token');
      return;
    }
    (async () => {
      try {
        const session = await api('/auth/confirm-email-change', {
          method: 'POST',
          auth: false,
          body: JSON.stringify({ token }),
        });
        saveSession(session as Parameters<typeof saveSession>[0]);
        setState('ok');
        setTimeout(() => {
          window.location.href = '/settings';
        }, 1200);
      } catch (err) {
        setState('error');
        setMessage(err instanceof Error ? err.message : 'Confirmation failed');
      }
    })();
  }, [params]);

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h1>Confirm email change</h1>
        {state === 'working' && <p className="muted">Confirming...</p>}
        {state === 'ok' && <p style={{ color: '#047857', fontWeight: 600 }}>Email updated</p>}
        {state === 'error' && (
          <>
            <p style={{ color: '#be123c' }}>{message}</p>
            <Link href="/settings" style={{ color: 'var(--accent)' }}>
              Back to settings
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConfirmEmailChangePage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailChangeInner />
    </Suspense>
  );
}