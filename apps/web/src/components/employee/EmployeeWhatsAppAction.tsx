'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { whatsAppChatUrl } from '@/lib/whatsapp';
import s from './EmployeeWhatsAppAction.module.css';

export function EmployeeWhatsAppAction({ applicationId }: { applicationId: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'no-phone' | 'failed' | ''>('');
  const request = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    const version = ++request.current;
    pending.current = false;
    setBusy(false);
    setError('');
    return () => {
      if (request.current === version) ++request.current;
    };
  }, [applicationId]);

  async function openWhatsApp() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const version = request.current;
    const actorId = getSession()?.user.id;
    let tab: Window | null = null;
    try {
      tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
    } catch {
      // Continue in the current tab if the browser blocks a new window.
    }

    try {
      const result = await api<{ phone?: string | null }>(
        '/applications/' + encodeURIComponent(applicationId) + '/recruiter-whatsapp-contact',
        { method: 'POST' },
      );
      if (version !== request.current || actorId !== getSession()?.user.id) {
        tab?.close();
        return;
      }
      const url = whatsAppChatUrl(result.phone);
      if (!url) {
        tab?.close();
        setError('no-phone');
        return;
      }
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch {
      tab?.close();
      if (version === request.current && actorId === getSession()?.user.id) setError('failed');
    } finally {
      if (version === request.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  const label = t(busy ? 'emp.whatsappOpening' : 'emp.whatsappChat');
  return (
    <span className={s.action}>
      <button
        type="button"
        className={s.button}
        aria-label={label}
        title={label}
        aria-busy={busy}
        disabled={busy}
        onClick={() => void openWhatsApp()}
      >
        <span className={s.icon} aria-hidden="true">
          <svg viewBox="0 0 32 32" focusable="false">
            <path d="M16 3.2A12.7 12.7 0 0 0 5.1 22.4L3.5 28.3l6.1-1.6A12.8 12.8 0 1 0 16 3.2Zm0 23.2c-2 0-3.9-.5-5.6-1.6l-.4-.2-3.6 1 1-3.5-.3-.4A10.2 10.2 0 1 1 16 26.4Zm5.6-7.6c-.3-.2-1.8-.9-2.1-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.4 8.4 0 0 1-2.5-1.5 9.4 9.4 0 0 1-1.7-2.1c-.2-.3 0-.5.2-.7l.5-.6c.2-.2.2-.4.3-.6s0-.4 0-.6-.7-1.7-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4s-1.2 1.2-1.2 2.8 1.2 3.2 1.4 3.4 2.4 3.7 5.8 5.2c.8.3 1.4.5 1.9.6.8.3 1.6.2 2.2.1.7-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4s-.3-.3-.6-.5Z" />
          </svg>
        </span>
        {label}
      </button>
      {error && (
        <span className={s.error} role="alert">
          {t(error === 'no-phone' ? 'emp.whatsappNoPhone' : 'emp.whatsappFailed')}
        </span>
      )}
    </span>
  );
}
