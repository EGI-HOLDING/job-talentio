'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ADMIN_URL, api, saveSession } from '@/lib/api';
import { FormAlert, FormField } from '@/components/ui/Field';
import { useI18n } from '@/lib/i18n';
import { localeHref } from '@/lib/navigation';

const TELEGRAM_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '';
const WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22';
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const TELEGRAM_OAUTH = 'https://oauth.telegram.org';

type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

type TelegramResponse =
  | { requiresRegistration: true; fullName: string; username: string | null }
  | { accessToken: string; user: { role: string; locale?: string } };

type TelegramAuthFn = (
  options: { bot_id: string | number; request_access?: string; lang?: string },
  callback: (user: TelegramUser | false) => void,
) => void;

declare global {
  interface Window {
    Telegram?: { Login?: { auth?: TelegramAuthFn } };
  }
}

let sdkPromise: Promise<void> | null = null;

function loadTelegramSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.Telegram?.Login?.auth) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const done = () => {
      if (window.Telegram?.Login?.auth) resolve();
      else reject(new Error('Telegram SDK failed to load'));
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${WIDGET_SRC}"]`);
    if (existing) {
      if (window.Telegram?.Login?.auth) {
        resolve();
        return;
      }
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Telegram SDK failed to load')),
        { once: true },
      );
      return;
    }
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.onload = done;
    script.onerror = () => reject(new Error('Telegram SDK failed to load'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function redirectAfterLogin(role: string) {
  if (role === 'RECRUITER') return '/';
  if (role === 'SUPER_ADMIN') return ADMIN_URL;
  return '/dashboard/employee';
}

function widgetFields(user: TelegramUser) {
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    photo_url: user.photo_url,
    auth_date: user.auth_date,
    hash: user.hash,
  };
}

function telegramAccountName(user: TelegramUser) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
}

function telegramWindowName(botId: string) {
  return `telegram_oauth_bot${botId}`;
}

function telegramPopupFeatures() {
  const width = 550;
  const height = 470;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));
  return `width=${width},height=${height},left=${left},top=${top},status=0,location=1,menubar=0,toolbar=0`;
}

function telegramLogoutUrl(botId: string) {
  const origin = window.location.origin;
  const q = new URLSearchParams({ bot_id: botId, origin });
  return `${TELEGRAM_OAUTH}/auth/logout?${q.toString()}`;
}

function writeHoldingPage(popup: Window) {
  try {
    popup.document.open();
    popup.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>Telegram</title></head><body style="font-family:sans-serif;padding:1.5rem;color:#334155">Telegram...</body></html>',
    );
    popup.document.close();
  } catch {
    /* popup already navigated or closed */
  }
}

export function TelegramSignIn({
  inviteToken,
  mode = 'login',
  onConnected,
}: {
  inviteToken?: string;
  mode?: 'login' | 'connect';
  onConnected?: () => void;
} = {}) {
  const { t, locale } = useI18n();
  const [botId, setBotId] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [widgetUser, setWidgetUser] = useState<TelegramUser | null>(null);
  const [pendingUser, setPendingUser] = useState<TelegramUser | null>(null);
  const [needsRole, setNeedsRole] = useState<{ fullName: string; username: string | null } | null>(
    null,
  );
  const [role, setRole] = useState<'EMPLOYEE' | 'RECRUITER'>('EMPLOYEE');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingRelogin, setAwaitingRelogin] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const submitTelegram = useCallback(
    async (
      user: TelegramUser,
      extras?: { role?: 'EMPLOYEE' | 'RECRUITER'; company?: string; email?: string },
    ) => {
      setBusy(true);
      setError('');
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 25_000);
      try {
        if (mode === 'connect') {
          const session = await api<Parameters<typeof saveSession>[0]>(
            '/auth/oauth/telegram/connect',
            {
              method: 'POST',
              signal: controller.signal,
              body: JSON.stringify(widgetFields(user)),
            },
          );
          saveSession(session);
          onConnected?.();
          return;
        }
        const res = await api<TelegramResponse>('/auth/oauth/telegram', {
          method: 'POST',
          auth: false,
          signal: controller.signal,
          body: JSON.stringify({
            ...widgetFields(user),
            role: extras?.role,
            companyName:
              extras?.role === 'RECRUITER' && !inviteToken ? extras.company : undefined,
            email: extras?.email?.trim() || undefined,
            locale,
            inviteToken: inviteToken || undefined,
          }),
        });
        if ('requiresRegistration' in res) {
          setNeedsRole({ fullName: res.fullName, username: res.username });
          return;
        }
        saveSession(res as Parameters<typeof saveSession>[0]);
        window.location.href = localeHref(redirectAfterLogin(res.user.role));
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        setError(
          aborted
            ? 'Sign-in timed out. Please try again.'
            : (err as Error).message || t('telegramSignInFailed'),
        );
      } finally {
        window.clearTimeout(timer);
        setBusy(false);
      }
    },
    [locale, inviteToken, mode, onConnected, t],
  );

  useEffect(() => {
    if (!TELEGRAM_BOT) return;
    let cancelled = false;
    api<{ available?: boolean; botId?: string }>('/auth/telegram/config', { auth: false })
      .then((r) => {
        if (!cancelled && r.available && r.botId) setBotId(r.botId);
      })
      .catch(() => undefined);
    loadTelegramSdk()
      .then(() => {
        if (!cancelled) setSdkReady(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const startTelegramAuth = useCallback(() => {
    if (!botId || busy) return;
    setError('');
    setAwaitingRelogin(false);
    const auth = window.Telegram?.Login?.auth;
    if (!auth) {
      setError(t('telegramSignInFailed'));
      return;
    }

    const name = telegramWindowName(botId);
    const features = telegramPopupFeatures();
    const nativeOpen = window.open.bind(window);
    const popup = nativeOpen('about:blank', name, features);
    if (!popup) {
      setError(t('telegramPopupBlocked'));
      return;
    }
    writeHoldingPage(popup);

    window.open = ((url: string | URL | undefined, _n?: string, feat?: string) =>
      nativeOpen(url, name, feat ?? features)) as typeof window.open;
    try {
      auth({ bot_id: botId, request_access: 'write', lang: locale }, (user) => {
        if (!aliveRef.current) return;
        if (user && typeof user === 'object' && user.hash) {
          setNeedsRole(null);
          setWidgetUser(user);
          setPendingUser(user);
        }
      });
    } finally {
      window.open = nativeOpen;
    }
  }, [botId, busy, locale, t]);

  const switchTelegramAccount = useCallback(() => {
    if (!botId || busy) return;
    setPendingUser(null);
    setWidgetUser(null);
    setNeedsRole(null);
    setError('');
    const popup = window.open(
      telegramLogoutUrl(botId),
      telegramWindowName(botId),
      telegramPopupFeatures(),
    );
    if (!popup) {
      setError(t('telegramPopupBlocked'));
      return;
    }
    setAwaitingRelogin(true);
  }, [botId, busy, t]);

  if (!TELEGRAM_BOT) return null;

  if (needsRole && widgetUser && mode === 'login') {
    return (
      <div className="google-signin">
        <div className="google-verify-card">
          <strong>{t('googleChooseRole')}</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0.75rem', fontSize: '0.9rem' }}>
            {needsRole.fullName}
            {needsRole.username ? ` (@${needsRole.username})` : ''}
          </p>
          {inviteToken ? (
            <FormField label={t('email')} required>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </FormField>
          ) : (
            <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
              {t('telegramEmailLaterHint')}
            </p>
          )}
          {inviteToken ? null : (
            <div className="chips" role="radiogroup" style={{ margin: '0.75rem 0' }}>
              <button
                type="button"
                role="radio"
                aria-checked={role === 'EMPLOYEE'}
                className={`chip ${role === 'EMPLOYEE' ? 'active' : ''}`}
                onClick={() => setRole('EMPLOYEE')}
              >
                {t('imCandidate')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={role === 'RECRUITER'}
                className={`chip ${role === 'RECRUITER' ? 'active' : ''}`}
                onClick={() => setRole('RECRUITER')}
              >
                {t('imHiring')}
              </button>
            </div>
          )}
          {role === 'RECRUITER' && !inviteToken && (
            <FormField label={t('companyName')} required>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                minLength={2}
                required
              />
            </FormField>
          )}
          <FormAlert>{error}</FormAlert>
          <button
            type="button"
            disabled={
              busy ||
              (Boolean(inviteToken) && !email.trim()) ||
              (!inviteToken && role === 'RECRUITER' && companyName.trim().length < 2)
            }
            onClick={() =>
              submitTelegram(widgetUser, {
                role: inviteToken ? 'RECRUITER' : role,
                company: companyName.trim(),
                email: email.trim() || undefined,
              })
            }
            style={{ marginTop: '0.5rem' }}
          >
            {busy ? t('creatingAccount') : t('continueLabel')}
          </button>
        </div>
      </div>
    );
  }

  if (pendingUser) {
    const name = telegramAccountName(pendingUser);
    return (
      <div className="google-signin">
        <div className="google-verify-card">
          <strong>{t('telegramConfirmTitle')}</strong>
          <div className="telegram-confirm-identity">
            {pendingUser.photo_url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pendingUser.photo_url}
                  alt=""
                  width={48}
                  height={48}
                  referrerPolicy="no-referrer"
                />
              </>
            ) : null}
            <div>
              <div>{name}</div>
              {pendingUser.username ? (
                <div className="muted" style={{ fontSize: '0.9rem' }}>
                  @{pendingUser.username}
                </div>
              ) : null}
            </div>
          </div>
          <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
            {t('telegramConfirmHint')}
          </p>
          <FormAlert>{error}</FormAlert>
          <div className="telegram-confirm-actions">
            <button type="button" disabled={busy} onClick={() => void submitTelegram(pendingUser)}>
              {busy ? t('signingIn') : t('continueLabel')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={switchTelegramAccount}
            >
              {t('telegramUseDifferent')}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                setPendingUser(null);
                setWidgetUser(null);
                setError('');
              }}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showDivider = mode === 'login' && !GOOGLE_CLIENT_ID;
  const ready = Boolean(botId) && sdkReady;

  return (
    <div className="google-signin">
      {showDivider && (
        <div className="auth-divider">
          <span>{t('orContinueWith')}</span>
        </div>
      )}
      <div className="telegram-btn-slot" style={{ marginTop: showDivider ? 0 : '0.75rem' }}>
        <button
          type="button"
          className="telegram-login-btn"
          disabled={!ready || busy}
          onClick={startTelegramAuth}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M21.5 3.2 2.8 10.4c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 11.1-7c.5-.3.9-.1.6.2l-9 8.1-.3 4.8c.4 0 .6-.2.8-.4l2.1-2 4.4 3.2c.8.5 1.4.2 1.6-.7l2.9-13.7c.3-1.2-.4-1.8-1.1-1.5z"
            />
          </svg>
          {busy ? t('signingIn') : t('telegramContinue')}
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0.55rem 0 0', textAlign: 'center' }}>
        {t(awaitingRelogin ? 'telegramLogoutThenContinue' : 'telegramSwitchHint')}
      </p>
      <FormAlert>{error}</FormAlert>
    </div>
  );
}
