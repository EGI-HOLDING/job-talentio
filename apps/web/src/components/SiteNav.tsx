'use client';

import { Link, localeHref } from '@/lib/navigation';
import { useEffect, useRef, useState } from 'react';
import { ADMIN_URL, api, getSession, logout, AuthSession } from '@/lib/api';
import { useI18n, Locale } from '@/lib/i18n';

type Notif = {
  id: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
};

const LOCALE_LABELS: Record<Locale, string> = { uz: "O'z", ru: 'Ру', en: 'En' };

export function SiteNav() {
  const { locale, setLocale, t } = useI18n();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = getSession();
    setSession(s);
    if (s) {
      api<{ count: number }>('/notifications/unread-count')
        .then((r) => setUnread(r.count))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  async function toggleNotifs() {
    if (!session) return;
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        const data = await api<{ items: Notif[]; unread: number }>('/notifications');
        setNotifs(data.items);
        setUnread(data.unread);
      } catch {
        /* ignore */
      }
    }
  }

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' });
    setUnread(0);
    setNotifs((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
  }

  function chooseLocale(l: Locale) {
    setLocale(l);
    setLangOpen(false);
    if (session) {
      api('/auth/me', { method: 'PATCH', body: JSON.stringify({ locale: l }) }).catch(() => undefined);
    }
  }

  const isRecruiter = session?.user.role === 'RECRUITER';
  const dash =
    session?.user.role === 'EMPLOYEE'
      ? '/dashboard/employee'
      : isRecruiter
        ? '/dashboard/recruiter'
        : null;

  return (
    <div className="nav-wrap">
      <nav className="nav shell">
        <Link href="/" className="brand">
          Job Talentio
        </Link>
        <div className="nav-links">
          {isRecruiter ? (
            <>
              <Link href="/talent">{t('findTalent')}</Link>
              <Link href="/dashboard/recruiter?tab=jobs&focus=create">{t('postAJob')}</Link>
              {dash && <Link href={dash}>{t('dashboard')}</Link>}
            </>
          ) : (
            <>
              <Link href="/jobs">{t('jobs')}</Link>
              {dash && <Link href={dash}>{t('dashboard')}</Link>}
            </>
          )}
          <Link href="/news">{t('news')}</Link>
          {session && <Link href="/messages">{t('messages')}</Link>}
          {session?.user.role === 'SUPER_ADMIN' && (
            <a href={ADMIN_URL} target="_blank" rel="noreferrer">
              Admin
            </a>
          )}
          <div className="lang-switch" ref={langRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="chip"
              aria-haspopup="listbox"
              aria-expanded={langOpen}
              aria-label={t('language')}
              onClick={(e) => {
                e.stopPropagation();
                setLangOpen((v) => !v);
              }}
            >
              {LOCALE_LABELS[locale]}
            </button>
            {langOpen && (
              <div
                className="notif-dropdown"
                role="listbox"
                aria-label={t('language')}
                style={{ minWidth: 160, right: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                {(['uz', 'ru', 'en'] as Locale[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="option"
                    aria-selected={l === locale}
                    className={`notif-item ${l === locale ? 'unread' : ''}`}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 0,
                      background: l === locale ? 'var(--accent-soft)' : 'transparent',
                      cursor: 'pointer',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      chooseLocale(l);
                    }}
                  >
                    <strong>
                      {l === 'uz' ? "O'zbekcha" : l === 'ru' ? 'Русский' : 'English'}
                    </strong>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!session ? (
            <>
              <Link href="/login">{t('login')}</Link>
              <Link href="/register" className="chip" style={{ background: 'var(--accent)', color: '#fff', border: 0 }}>
                {t('register')}
              </Link>
            </>
          ) : (
            <div className="nav-user" ref={ref}>
              <div style={{ position: 'relative' }}>
                <button type="button" className="notif-btn" onClick={toggleNotifs} aria-label={t('notifications')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
                </button>
                {open && (
                  <div className="notif-dropdown">
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
                      <strong>{t('notifications')}</strong>
                      {unread > 0 && (
                        <button type="button" className="ghost" onClick={markAll}>
                          {t('markAllRead')}
                        </button>
                      )}
                    </div>
                    {notifs.length === 0 && <div className="notif-item muted">{t('noNotifications')}</div>}
                    {notifs.map((n) => (
                      <a
                        key={n.id}
                        href={n.linkUrl || '#'}
                        className={`notif-item ${n.readAt ? '' : 'unread'}`}
                        onClick={() => api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined)}
                      >
                        <strong>{n.title}</strong>
                        {n.body && <span>{n.body}</span>}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <Link href="/settings" className="nav-user" title={t('settings')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="avatar"
                  src={(session.user as { avatarUrl?: string }).avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(session.user.fullName)}`}
                  alt=""
                />
                <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: '0.9rem' }}>
                  {session.user.fullName.split(' ')[0]}
                </span>
              </Link>
              <button
                type="button"
                className="secondary"
                style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
                onClick={async () => {
                  await logout();
                  window.location.href = localeHref('/');
                }}
              >
                {t('logout')}
              </button>
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}
