'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ADMIN_URL, api, saveSession } from '@/lib/api';
import { FormAlert, FormField } from '@/components/ui/Field';
import { useI18n } from '@/lib/i18n';
import { localeHref } from '@/lib/navigation';

const TELEGRAM_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '';
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
  | { accessToken: string; user: { role: string; locale?: string } };

declare global {
  interface Window {
    onJobTalentioTelegramAuth?: (user: TelegramUser) => void;
  }
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
  const slotRef = useRef<HTMLDivElement>(null);
  const [widgetUser, setWidgetUser] = useState<TelegramUser | null>(null);
  const [needsRole, setNeedsRole] = useState<{ fullName: string; username: string | null } | null>(
    null,
  );
  const [role, setRole] = useState<'EMPLOYEE' | 'RECRUITER'>('EMPLOYEE');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  const submitRef = useRef(submitTelegram);
  useEffect(() => {
    submitRef.current = submitTelegram;
  }, [submitTelegram]);

  useEffect(() => {
    if (!TELEGRAM_BOT || !slotRef.current) return;
    window.onJobTalentioTelegramAuth = (user) => {
      setWidgetUser(user);
      submitRef.current(user);
    };
    slotRef.current.innerHTML = '';
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.setAttribute('data-telegram-login', TELEGRAM_BOT);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', 'onJobTalentioTelegramAuth(user)');
    slotRef.current.appendChild(script);
    return () => {
      delete window.onJobTalentioTelegramAuth;
    };
  }, []);

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

  const showDivider = mode === 'login' && !GOOGLE_CLIENT_ID;

  return (
    <div className="google-signin">
      {showDivider && (
        <div className="auth-divider">
          <span>{t('orContinueWith')}</span>
        </div>
      )}
      <div ref={slotRef} className="telegram-btn-slot" style={{ marginTop: showDivider ? 0 : '0.75rem' }} />
      {busy && (
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
          {t('signingIn')}
        </p>
      )}
      <FormAlert>{error}</FormAlert>
    </div>
  );
}
