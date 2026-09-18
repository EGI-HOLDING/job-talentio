'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { localeHref } from '@/lib/navigation';

type Props = {
  /** Locale-less path, e.g. `/jobs/abc`; the active locale is added. */
  path: string;
  title: string;
  /** Message body for Telegram / the share sheet; defaults to the title. */
  text?: string;
  className?: string;
};

/**
 * Share a page. On touch devices the OS share sheet opens (Telegram is one
 * tap away there); elsewhere a small menu offers Telegram and copy link,
 * because Telegram is where postings travel in Uzbekistan.
 */
export function ShareButton({ path, title, text, className = 'secondary' }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function absoluteUrl(): string {
    if (typeof window === 'undefined') return path;
    return `${window.location.origin}${localeHref(path)}`;
  }

  async function onShare() {
    const url = absoluteUrl();
    const coarse =
      typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (coarse && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: text || title, url });
      } catch {
        // The user closed the sheet; nothing to report.
      }
      return;
    }
    setOpen((v) => !v);
  }

  async function copyLink() {
    const url = absoluteUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('share.copyLink'), url);
    }
  }

  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(absoluteUrl())}&text=${encodeURIComponent(text || title)}`;

  return (
    <span ref={rootRef} className="share-wrap">
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => void onShare()}
      >
        {t('share')}
      </button>
      {open && (
        <div role="menu" className="share-menu card">
          <a
            role="menuitem"
            className="chip"
            href={telegramHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            {t('share.telegram')}
          </a>
          <button role="menuitem" type="button" className="chip" onClick={() => void copyLink()}>
            {copied ? t('share.copied') : t('share.copyLink')}
          </button>
        </div>
      )}
    </span>
  );
}
