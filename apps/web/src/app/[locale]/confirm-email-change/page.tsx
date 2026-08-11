'use client';

import { Link, localeHref } from '@/lib/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, saveSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function ConfirmEmailChangeInner() {
  const params = useSearchParams();
  const { t } = useI18n();
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get('token');
    if (!token) {
      setState('error');
      setMessage(t('ui.missingConfirmationToken'));
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
          window.location.href = localeHref('/settings');
        }, 1200);
      } catch (err) {
        setState('error');
        setMessage(err instanceof Error ? err.message : t('ui.confirmationFailed'));
      }
    })();
  }, [params, t]);

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h1>{t('ui.confirmEmailChange')}</h1>
        {state === 'working' && <p className="muted">{t('ui.confirming')}</p>}
        {state === 'ok' && (
          <p style={{ color: '#047857', fontWeight: 600 }}>{t('ui.emailUpdated')}</p>
        )}
        {state === 'error' && (
          <>
            <p style={{ color: '#be123c' }}>{message}</p>
            <Link href="/settings" style={{ color: 'var(--accent)' }}>
              {t('ui.backToSettings')}
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