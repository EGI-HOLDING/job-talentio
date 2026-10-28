'use client';
import { authDestination, authRoleErrorKey, roleMismatchKey, type AuthRole } from '@/lib/authReturn';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ADMIN_URL, api, saveSession } from '@/lib/api';
import { FormAlert, FormField } from '@/components/ui/Field';
import { useI18n } from '@/lib/i18n';
import { localeHref } from '@/lib/navigation';
import { loadAuthSdk } from '@/lib/authSdk';

const WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22';
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

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
  | { accessToken: string; joinedCompanyId?: string; user: { role: string; locale?: string } };

type TelegramAuthFn = (
  options: { bot_id: string | number; request_access?: string; lang?: string },
  callback: (user: TelegramUser | false) => void,
) => void;

declare global {
  interface Window {
    Telegram?: { Login?: { auth?: TelegramAuthFn } };
  }
}

function redirectAfterLogin(role: string, companyId?: string) {
  if (role === 'RECRUITER') return '/dashboard/recruiter?tab=jobs' + (companyId ? `&company=${encodeURIComponent(companyId)}` : '');
  if (role === 'SUPER_ADMIN') return ADMIN_URL;
  return '/jobs?mode=for-you';
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

export function TelegramSignIn({
  inviteToken,
  accountRole = 'EMPLOYEE',
  showWhenUnavailable = false,
  mode = 'login',
  onConnected,
}: {
  inviteToken?: string;
  accountRole?: AuthRole;
  showWhenUnavailable?: boolean;
  mode?: 'login' | 'connect';
  onConnected?: () => void;
} = {}) {
  const { t, locale } = useI18n();
  const [botId, setBotId] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [provider, setProvider] = useState<'loading' | 'ready' | 'unavailable' | 'failed'>('loading');
  const [providerRetry, setProviderRetry] = useState(0);
  const [widgetUser, setWidgetUser] = useState<TelegramUser | null>(null);
  const [inviteIdentity, setInviteIdentity] = useState<{ fullName: string; username: string | null } | null>(
    null,
  );
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      extras?: { role?: 'EMPLOYEE' | 'RECRUITER'; email?: string },
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
            expectedRole: accountRole,
            email: extras?.email?.trim() || undefined,
            locale,
            inviteToken: inviteToken || undefined,
          }),
        });
        if ('requiresRegistration' in res) {
          setInviteIdentity({ fullName: res.fullName, username: res.username });
          return;
        }
        const mismatch = accountRole && roleMismatchKey(res.user.role, accountRole);
        if (mismatch && !inviteToken) { setError(t(mismatch)); return; }
        saveSession(res as Parameters<typeof saveSession>[0]);
        window.location.href = localeHref(authDestination(redirectAfterLogin(res.user.role, res.joinedCompanyId)));
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        setError(
          aborted
            ? t('authProvider.timeout')
            : (authRoleErrorKey((err as Error).message) ? t(authRoleErrorKey((err as Error).message)!) : (err as Error).message) || t('telegramSignInFailed'),
        );
      } finally {
        window.clearTimeout(timer);
        setBusy(false);
      }
    },
    [locale, inviteToken, mode, onConnected, accountRole, t],
  );

  const submitRef = useRef(submitTelegram);
  useEffect(() => {
    submitRef.current = submitTelegram;
  }, [submitTelegram]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    setProvider('loading'); setSdkReady(false); setBotId(null);
    void (async () => {
      try {
        const config = await api<{ available?: boolean; botId?: string }>('/auth/telegram/config', { auth: false, signal: controller.signal });
        window.clearTimeout(timer);
        if (cancelled) return;
        if (!config.available || !config.botId) { setProvider('unavailable'); return; }
        await loadAuthSdk(WIDGET_SRC, () => Boolean(window.Telegram?.Login?.auth));
        if (!cancelled) { setBotId(config.botId); setSdkReady(true); setProvider('ready'); }
      } catch { if (!cancelled) setProvider('failed'); }
      finally { window.clearTimeout(timer); }
    })();
    return () => {
      cancelled = true;
      controller.abort(); window.clearTimeout(timer);
    };
  }, [providerRetry]);

  const startTelegramAuth = useCallback(() => {
    if (!botId || busy) return;
    setError('');
    setInviteIdentity(null);
    const auth = window.Telegram?.Login?.auth;
    if (!auth) {
      setError(t('telegramSignInFailed'));
      return;
    }

    const nativeOpen = window.open.bind(window);
    let popup: Window | null = null;
    window.open = ((...args: Parameters<typeof window.open>) => {
      popup = nativeOpen(...args);
      return popup;
    }) as typeof window.open;
    try {
      auth({ bot_id: botId, request_access: 'write', lang: locale }, (user) => {
        if (!aliveRef.current) return;
        if (user && typeof user === 'object' && user.hash) {
          setWidgetUser(user);
          const defaultRole = accountRole ? { role: accountRole } : undefined;
          void submitRef.current(user, defaultRole);
        }
      });
    } finally {
      window.open = nativeOpen;
    }
    if (!popup) {
      setError(t('telegramPopupBlocked'));
    }
  }, [botId, busy, locale, t, accountRole]);

  if (provider === 'unavailable' && !showWhenUnavailable) return null;

  if (inviteIdentity && widgetUser && inviteToken && mode === 'login') {
    return (
      <div className="google-signin">
        <div className="google-verify-card">
          <strong>{t('inviteJoinTitle')}</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0.75rem', fontSize: '0.9rem' }}>
            {inviteIdentity.fullName}
            {inviteIdentity.username ? ` (@${inviteIdentity.username})` : ''}
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
          <FormAlert>{error}</FormAlert>
          <button
            type="button"
            disabled={
              busy ||
              (Boolean(inviteToken) && !email.trim())
            }
            onClick={() =>
              submitTelegram(widgetUser, {
                role: accountRole,
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

  const showDivider = mode === 'login' && !GOOGLE_CLIENT_ID && !showWhenUnavailable;
  const ready = Boolean(botId) && sdkReady;

  return (
    <div className="google-signin">
      {showDivider && (
        <div className="auth-divider">
          <span>{t('orContinueWith')}</span>
        </div>
      )}
      <div className="telegram-btn-slot">
        <button
          type="button"
          className="auth-social-btn auth-social-btn--telegram"
          disabled={!ready || busy}
          onClick={startTelegramAuth}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M21.5 3.2 2.8 10.4c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 11.1-7c.5-.3.9-.1.6.2l-9 8.1-.3 4.8c.4 0 .6-.2.8-.4l2.1-2 4.4 3.2c.8.5 1.4.2 1.6-.7l2.9-13.7c.3-1.2-.4-1.8-1.1-1.5z"
            />
          </svg>
          {busy
            ? t('signingIn')
            : mode === 'connect'
              ? t('telegramConnectCta')
              : t('telegramContinue')}
        </button>
      </div>
      {provider !== 'ready' && <p className="auth-provider-feedback" role={provider === 'failed' ? 'alert' : 'status'}>{t(provider === 'loading' ? 'authProvider.loading' : provider === 'failed' ? 'authProvider.loadFailed' : 'authProvider.unavailable')}{provider === 'failed' && <button type="button" className="ghost" onClick={() => setProviderRetry(value => value + 1)}>{t('workspace.retry')}</button>}</p>}
      <FormAlert>{error}</FormAlert>
    </div>
  );
}
