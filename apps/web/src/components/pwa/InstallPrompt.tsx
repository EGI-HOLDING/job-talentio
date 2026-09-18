'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

const DISMISS_KEY = 'jt.installPrompt.dismissedAt';
const DISMISS_DAYS = 14;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function recentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * One small "add to home screen" bar on phones. Chrome/Android fires
 * beforeinstallprompt; iOS Safari has no API, so it gets a short hint instead.
 */
export function InstallPrompt() {
  const { t } = useI18n();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<'hidden' | 'native' | 'ios'>('hidden');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone() || recentlyDismissed()) return;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (!coarse) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setMode('native');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIos()) {
      iosTimer = setTimeout(() => setMode((m) => (m === 'hidden' ? 'ios' : m)), 4000);
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // storage unavailable; the bar simply returns next visit
    }
    setMode('hidden');
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    if (choice.outcome === 'accepted') setMode('hidden');
    else dismiss();
    setDeferred(null);
  }

  if (mode === 'hidden') return null;

  return (
    <div className="install-bar" role="region" aria-label={t('pwa.installTitle')}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={40} height={40} className="install-bar-icon" />
      <div className="install-bar-body">
        <strong>{t('pwa.installTitle')}</strong>
        <span className="muted">{mode === 'ios' ? t('pwa.iosHint') : t('pwa.installBody')}</span>
      </div>
      <div className="install-bar-actions">
        {mode === 'native' && (
          <button type="button" className="cta" onClick={() => void install()}>
            {t('pwa.installAction')}
          </button>
        )}
        <button type="button" className="ghost" onClick={dismiss} aria-label={t('pwa.dismiss')}>
          {t('pwa.dismiss')}
        </button>
      </div>
    </div>
  );
}
