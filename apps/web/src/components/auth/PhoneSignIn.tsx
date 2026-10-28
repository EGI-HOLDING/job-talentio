'use client';
import { authDestination, roleMismatchKey, type AuthRole } from '@/lib/authReturn';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ADMIN_URL, api, saveSession } from '@/lib/api';
import { FormAlert, FormField } from '@/components/ui/Field';
import { useI18n } from '@/lib/i18n';
import { localeHref } from '@/lib/navigation';

type Providers = { telegram: boolean; sms: boolean };
type Session = Parameters<typeof saveSession>[0] & { user: { role: string } };
type StartResponse = { token: string; deepLink: string; botUsername: string; expiresAt: string };
type StatusResponse =
  | { status: 'PENDING' | 'CONTACT_REQUESTED' | 'EXPIRED' }
  | { status: 'COMPLETED'; session: Session };

const POLL_MS = 2500;

function redirectAfterLogin(role: string) {
  if (role === 'RECRUITER') return '/dashboard/recruiter?tab=jobs';
  if (role === 'SUPER_ADMIN') return ADMIN_URL;
  return '/jobs?mode=for-you';
}

/**
 * Phone number as the front door. The Telegram route asks the bot for the
 * user's contact (verified by Telegram, no SMS cost); the SMS route appears
 * only when the API has an operator account configured.
 */
export function PhoneSignIn({ accountRole, showWhenUnavailable = false }: { accountRole?: AuthRole; showWhenUnavailable?: boolean } = {}) {
  const { t, locale } = useI18n();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [providerError, setProviderError] = useState(false);
  const [providerRetry, setProviderRetry] = useState(0);
  const [mode, setMode] = useState<'idle' | 'telegram' | 'sms'>('idle');
  const [waiting, setWaiting] = useState<StartResponse | null>(null);
  const [contactRequested, setContactRequested] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef(false);
  const attemptRef = useRef(0);
  const aliveRef = useRef(true);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    let cancelled = false;
    aliveRef.current = true;
    setProviderError(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    api<Providers>('/auth/phone/providers', { auth: false, signal: controller.signal })
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch(() => {
        if (!cancelled) { setProviders({ telegram: false, sms: false }); setProviderError(true); }
      }).finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      aliveRef.current = false;
      attemptRef.current += 1;
      controller.abort(); window.clearTimeout(timer);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [providerRetry]);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function finish(session: Session) {
    stopPolling();
    const mismatch = accountRole && roleMismatchKey(session.user.role, accountRole);
    if (mismatch) { setError(t(mismatch)); setWaiting(null); return; }
    saveSession(session);
    window.location.href = localeHref(authDestination(redirectAfterLogin(session.user.role)));
  }

  async function startTelegram() {
    if (busy) return;
    setError('');
    setBusy(true);
    const attempt = ++attemptRef.current;
    // Open synchronously from the click so browsers do not block the delayed deep link.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    try {
      const start = await api<StartResponse>('/auth/phone/telegram/start', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ locale, role: accountRole }),
      });
      if (!aliveRef.current || attempt !== attemptRef.current) { popup?.close(); return; }
      setWaiting(start);
      setContactRequested(false);
      setMode('telegram');
      // Open the bot in the Telegram app (mobile) or web (desktop).
      if (popup && !popup.closed) popup.location.replace(start.deepLink);
      stopPolling();
      pollRef.current = setInterval(async () => {
        if (pollingRef.current || !aliveRef.current || attempt !== attemptRef.current) return;
        if (Date.parse(start.expiresAt) <= Date.now()) { stopPolling(); setWaiting(null); setError(t('phone.expired')); return; }
        pollingRef.current = true;
        try {
          const res = await api<StatusResponse>(
            `/auth/phone/telegram/status?token=${encodeURIComponent(start.token)}`,
            { auth: false },
          );
          if (!aliveRef.current || attempt !== attemptRef.current) return;
          if (res.status === 'COMPLETED') finishRef.current(res.session);
          else if (res.status === 'EXPIRED') {
            stopPolling();
            setWaiting(null);
            setError(t('phone.expired'));
          } else if (res.status === 'CONTACT_REQUESTED') setContactRequested(true);
        } catch (err) {
          if (!aliveRef.current || attempt !== attemptRef.current) return;
          stopPolling();
          setWaiting(null);
          setError(err instanceof Error ? err.message : t('phone.failed'));
        } finally { pollingRef.current = false; }
      }, POLL_MS);
    } catch (err) {
      popup?.close();
      if (aliveRef.current) setError(err instanceof Error ? err.message : t('phone.failed'));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }

  async function requestCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/auth/phone/request', { method: 'POST', auth: false, body: JSON.stringify({ phone }) });
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('phone.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const session = await api<Session>('/auth/phone/verify', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ phone, code: String(fd.get('code') || '').trim(), locale, role: accountRole }),
      });
      finish(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('phone.failed'));
    } finally {
      setBusy(false);
    }
  }

  if ((!providers || (!providers.telegram && !providers.sms)) && !showWhenUnavailable) return null;

  return (
    <div className="google-signin">
      {(providers?.telegram || showWhenUnavailable) && mode !== 'sms' && (
        <div className="telegram-btn-slot">
          <button
            type="button"
            className="auth-social-btn auth-social-btn--phone"
            disabled={busy || !providers?.telegram}
            onClick={() => void startTelegram()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"
              />
            </svg>
            {waiting ? t('phone.waitingShort') : t('phone.telegramCta')}
          </button>
        </div>
      )}
      {(!providers || (!providers.telegram && !providers.sms)) && <p className="auth-provider-feedback" role={providerError ? 'alert' : 'status'}>{t(!providers ? 'authProvider.loading' : providerError ? 'authProvider.loadFailed' : 'authProvider.unavailable')}{providerError && <button type="button" className="ghost" onClick={() => setProviderRetry(value => value + 1)}>{t('workspace.retry')}</button>}</p>}

      {mode === 'telegram' && waiting && (
        <div className="google-verify-card" role="status">
          <strong>{contactRequested ? t('phone.tapShare') : t('phone.openBot')}</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0.6rem', fontSize: '0.9rem' }}>
            {t('phone.telegramSteps').replace('{bot}', `@${waiting.botUsername}`)}
          </p>
          <a
            className="chip"
            href={waiting.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex' }}
          >
            {t('phone.reopenTelegram')}
          </a>
          <button
            type="button"
            className="ghost"
            style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}
            onClick={() => {
              stopPolling();
              attemptRef.current += 1;
              setWaiting(null);
              setMode('idle');
            }}
          >
            {t('cancel')}
          </button>
        </div>
      )}

      {providers?.sms && mode !== 'telegram' && (
        <div style={{ marginTop: '0.6rem' }}>
          {mode !== 'sms' ? (
            <button type="button" className="ghost" onClick={() => setMode('sms')}>
              {t('phone.smsCta')}
            </button>
          ) : !codeSent ? (
            <form className="form-stack" onSubmit={requestCode}>
              <FormField label={t('phone.number')} required>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+998 90 123 45 67"
                  required
                />
              </FormField>
              <button type="submit" disabled={busy || phone.replace(/\D/g, '').length < 9}>
                {busy ? t('phone.sending') : t('phone.sendCode')}
              </button>
            </form>
          ) : (
            <form className="form-stack" onSubmit={verifyCode}>
              <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                {t('phone.codeSentTo').replace('{phone}', phone)}
              </p>
              <FormField label={t('phone.code')} required>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4,8}" required />
              </FormField>
              <button type="submit" disabled={busy}>
                {busy ? t('signingIn') : t('phone.verify')}
              </button>
              <button type="button" className="ghost" onClick={() => setCodeSent(false)}>
                {t('phone.changeNumber')}
              </button>
            </form>
          )}
        </div>
      )}

      <FormAlert>{error}</FormAlert>
    </div>
  );
}
