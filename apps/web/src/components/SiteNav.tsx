'use client';

import { Link, localeHref, usePathname, useRouter } from '@/lib/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ADMIN_URL, api, getSession, logout, AuthSession } from '@/lib/api';
import { useI18n, Locale } from '@/lib/i18n';
import styles from './SiteNav.module.css';
import { AuthLink } from './auth/AuthLink';
import { authRoleFrom } from '@/lib/authReturn';
import { preferredCompany, rememberCompany } from './recruiter/RecruiterPrimitives';
import { WorkspaceIcon } from './employee/WorkspaceIcon';
import { allowEmployerContextChange } from './recruiter/useEmployerUnsaved';

type Notif = {
  id: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
};

const LOCALE_LABELS: Record<Locale, string> = { uz: "O'z", ru: 'Ру', en: 'En', id: 'ID' };

function SiteNavContent() {
  const { locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [companies, setCompanies] = useState<Array<{companyId: string; company: {name: string}}>>([]);
  const [rememberedCompany, setRememberedCompany] = useState('');
  const searchParams = useSearchParams();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const navWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = navWrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--app-nav-height', element.getBoundingClientRect().height + 'px'));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const refreshSession = () => setSession(getSession());
    window.addEventListener('jt-session-updated', refreshSession);
    window.addEventListener('storage', refreshSession);
    return () => { window.removeEventListener('jt-session-updated', refreshSession); window.removeEventListener('storage', refreshSession); };
  }, []);

  useEffect(() => { setMenuOpen(false); setAccountOpen(false); }, [pathname, searchParams, locale]);
  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButtonRef.current?.focus(); }
      if (event.key === 'Escape' && accountOpen) { setAccountOpen(false); accountButtonRef.current?.focus(); }
    }
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [menuOpen, accountOpen]);

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
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    setCompanies([]);
    if (session?.user.role !== 'RECRUITER') return;
    let active = true;
    api<Array<{companyId: string; company: {name: string}}>>('/companies/mine').then(mine => {
      if (!active) return;
      setCompanies(mine);
      setRememberedCompany(preferredCompany(mine)?.companyId || '');
    }).catch(() => undefined);
    return () => { active = false; };
  }, [session?.user.id, session?.user.role]);

  useEffect(() => {
    const update = () => setRememberedCompany(preferredCompany(companies)?.companyId || '');
    window.addEventListener('talentio:company', update);
    return () => window.removeEventListener('talentio:company', update);
  }, [companies]);

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

  async function chooseLocale(l: Locale) {
    if (!await allowEmployerContextChange()) return;
    setLocale(l);
    setLangOpen(false);
    if (session) {
      api('/auth/me', { method: 'PATCH', body: JSON.stringify({ locale: l }) }).catch(() => undefined);
    }
  }

  const activeCompany = companies.find(item => item.companyId === searchParams.get('company')) || companies.find(item => item.companyId === rememberedCompany) || companies[0];
  const companyHref = '/dashboard/recruiter?tab=company' + (activeCompany ? '&company=' + encodeURIComponent(activeCompany.companyId) : '');

  const isOnboarding = pathname.startsWith('/onboarding/');
  const isRecruiter = session?.user.role === 'RECRUITER';
  const isEmployee = session?.user.role === 'EMPLOYEE';
  const isJobs = pathname === '/jobs' || pathname.startsWith('/jobs/');
  const isCompanies = pathname === '/explore/companies' || pathname.startsWith('/companies/');
  const isInsights = pathname === '/news' || pathname.startsWith('/news/');
  const isPublic = !/^\/(dashboard|settings|messages|talent|candidates|billing)(\/|$)/.test(pathname);
  const isEmployerContext = pathname === '/employers' || (/^\/(login|register|forgot-password|reset-password)$/.test(pathname) && (searchParams.get('role') === 'RECRUITER' || Boolean(searchParams.get('invite'))));
  const accountRole = isEmployerContext ? 'RECRUITER' : authRoleFrom(searchParams.get('role'));
  const isLanding = isEmployee || isRecruiter || (isPublic && isEmployerContext) || (isPublic && !session);
  const isDiscovery = isEmployee || isRecruiter || (isLanding && pathname !== '/' && pathname !== '/employers');
  const employeeTab = searchParams.get('tab');
  const recruiterTab = searchParams.get('tab') || 'jobs';
  const recruiterActive = [(pathname === '/dashboard/recruiter' && ['jobs', 'pipeline', 'bulk'].includes(recruiterTab)) || pathname.startsWith('/dashboard/recruiter/jobs/') || pathname.startsWith('/jobs/') || pathname.startsWith('/candidates/'), pathname === '/messages', pathname === '/dashboard/recruiter' && recruiterTab === 'analytics'];
  const browseLinks = isOnboarding
    ? [['/jobs', 'home.findJobs'], ['/explore/companies', 'companiesStat'], ['/news', 'landing.insights']]
    : isRecruiter
    ? [['/dashboard/recruiter?tab=jobs', 'jobs'], ['/messages?role=RECRUITER', 'messages'], ['/dashboard/recruiter?tab=analytics', 'rec.tabAnalytics']]
    : isEmployee
    ? [['/jobs', 'home.findJobs'], ['/dashboard/employee?tab=applications', 'applications'], ['/dashboard/employee?tab=saved', 'savedJobs'], ['/messages', 'messages']]
    : isEmployerContext
    ? [['/employers#how-it-works', 'employers.how'], ['/employers#hiring-insights', 'employers.insights']]
    : [['/jobs', 'home.findJobs'], ['/explore/companies', 'companiesStat'], ['/news', 'landing.insights']];
  const dash =
    session?.user.role === 'EMPLOYEE'
      ? '/jobs?mode=for-you'
      : isRecruiter
        ? '/dashboard/recruiter'
        : null;

  return (
    <div ref={navWrapRef} className={`nav-wrap ${isLanding ? styles.landing : ''} ${isDiscovery ? styles.jobs : ''} ${isEmployee ? styles.employee : ''} ${isRecruiter ? styles.recruiter : ''}`}>
      <nav className={`nav shell ${isLanding ? styles.landingNav : ''}`}>
        <div className={isLanding ? styles.primary : undefined}>
        <Link href={isRecruiter ? '/dashboard/recruiter?tab=jobs' : isEmployee ? '/jobs' : isEmployerContext ? '/employers' : '/'} className={`brand ${isLanding ? styles.brand : ''} ${(isRecruiter || isEmployerContext) && !isEmployee ? styles.employerBrand : ''}`}>
          <span>Job Talentio</span>{(isRecruiter || isEmployerContext) && !isEmployee && <small>{t('employers.badge')}</small>}
        </Link>
        {isLanding && (
          <div className={styles.browse}>
            {browseLinks.map(([href, key], index) => <Link key={href} href={href} aria-current={(isRecruiter ? recruiterActive[index] : isEmployee ? [isJobs, pathname === '/dashboard/employee' && employeeTab === 'applications', pathname === '/dashboard/employee' && employeeTab === 'saved', pathname === '/messages'][index] : !isEmployerContext && [isJobs, isCompanies, isInsights][index]) ? 'page' : undefined}>{t(key)}</Link>)}
            {!session && <Link className={styles.mobileEmployer} href={isEmployerContext ? '/' : '/employers'}>{t(isEmployerContext ? 'employers.seekers' : 'recruiterHeroBadge')} <span aria-hidden="true">{'\u2197'}</span></Link>}
          </div>
        )}
        </div>
        <div className={`nav-links ${isLanding ? styles.landingLinks : ''} ${isLanding && session ? styles.signedIn : ''}`}>
          {!isLanding && <><Link href="/jobs">{t('jobs')}</Link>{dash && <Link href={dash}>{t('dashboard')}</Link>}</>}
          {!isLanding && <Link href="/news">{t('news')}</Link>}
          {isLanding && !session && <Link className={styles.employer} href={isEmployerContext ? '/' : '/employers'}>{t(isEmployerContext ? 'employers.seekers' : 'recruiterHeroBadge')} <span aria-hidden="true">{'\u2197'}</span></Link>}
          {session && !isEmployee && !isRecruiter && <Link href="/messages">{t('messages')}</Link>}
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
              {isOnboarding && locale === 'id' ? 'Indonesia' : LOCALE_LABELS[locale]}
            </button>
            {langOpen && (
              <div
                className="notif-dropdown"
                role="listbox"
                aria-label={t('language')}
                style={{ minWidth: 160, right: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                {(['uz', 'ru', 'en', 'id'] as Locale[]).map((l) => (
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
                      {l === 'uz'
                        ? "O'zbekcha"
                        : l === 'ru'
                          ? 'Русский'
                          : l === 'id'
                            ? 'Indonesia'
                            : 'English'}
                    </strong>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!session ? (
            <>
              <AuthLink href="/login" accountRole={accountRole}>{t(isEmployerContext ? 'employers.login' : 'login')}</AuthLink>
              <AuthLink href="/register" accountRole={accountRole} next={isEmployerContext ? '/dashboard/recruiter?tab=jobs&focus=create' : undefined} className={isLanding ? styles.register : 'chip'} style={isLanding ? undefined : { background: 'var(--accent)', color: '#fff', border: 0 }}>
                {isEmployerContext ? t('postAJob') : isLanding ? t('home.createProfile') : t('register')}
              </AuthLink>
            </>
          ) : (
            <div className="nav-user" ref={ref}>
              {!isOnboarding && <div style={{ position: 'relative' }}>
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
                    {notifs.map((n) => {
                      const href = n.linkUrl && n.linkUrl !== '#' ? n.linkUrl : null;
                      const className = `notif-item ${n.readAt ? '' : 'unread'}`;
                      const openNotif = () => {
                        setOpen(false);
                        void api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
                      };
                      if (!href) {
                        return (
                          <button key={n.id} type="button" className={className} onClick={openNotif}>
                            <strong>{n.title}</strong>
                            {n.body && <span>{n.body}</span>}
                          </button>
                        );
                      }
                      return (
                        <Link key={n.id} href={href} className={className} onClick={openNotif}>
                          <strong>{n.title}</strong>
                          {n.body && <span>{n.body}</span>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>}
              {isEmployee || isRecruiter ? <div className={styles.account} ref={accountRef}>
                <button ref={accountButtonRef} type="button" className={styles.accountButton} aria-label={t('workspace.accountMenu')} aria-expanded={accountOpen} aria-controls="workspace-account-menu" onClick={() => { setAccountOpen((value) => !value); setOpen(false); setLangOpen(false); }}>
                  {session.user.avatarUrl ? <img className="avatar" src={session.user.avatarUrl} alt="" /> : <span className={styles.initial}>{session.user.fullName.charAt(0)}</span>}
                  <span className={styles.accountName}>{isRecruiter && activeCompany ? activeCompany.company.name : session.user.fullName.split(' ')[0]}</span>{isRecruiter && (!session.user.email || session.user.emailVerified === false) && <i className={styles.accountAttention} title={t(session.user.email ? 'emailUnverifiedBadge' : 'addEmailTitle')} />}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {accountOpen && <div id="workspace-account-menu" className={styles.accountMenu}>
                  <div className={styles.accountIdentity}><strong>{session.user.fullName}</strong><span>{session.user.email}</span>{isRecruiter && (!session.user.email || session.user.emailVerified === false) && <Link className={styles.verificationLink} href="/settings?role=RECRUITER"><i />{t(session.user.email ? 'emailUnverifiedBadge' : 'addEmailTitle')}<WorkspaceIcon kind="right" /></Link>}</div>
                  {isRecruiter && companies.length > 0 && <div className={styles.companyChoices}><span>{t('company')}</span>{companies.map(item => <button key={item.companyId} type="button" aria-pressed={item.companyId === activeCompany?.companyId} onClick={async () => { if (!await allowEmployerContextChange()) return; rememberCompany(item.companyId); setRememberedCompany(item.companyId); setAccountOpen(false); router.push('/dashboard/recruiter?tab=jobs&company=' + encodeURIComponent(item.companyId)); }}><WorkspaceIcon kind="building" /><span>{item.company.name}</span>{item.companyId === activeCompany?.companyId && <WorkspaceIcon kind="check" />}</button>)}</div>}
                  {isRecruiter ? <><Link href={companyHref}>{t('rw.companyProfile')}</Link><Link href={companyHref + '&panel=promotion'}>{t('rw.promotion')}</Link></> : <><Link href="/dashboard/employee?tab=profile">{t('workspace.profileCv')}</Link><Link href="/dashboard/employee?tab=alerts">{t('workspace.jobAlerts')}</Link></>}
                  <Link href={isRecruiter ? '/settings?role=RECRUITER' : '/settings?role=EMPLOYEE'}>{t('settings')}</Link>
                  {isRecruiter && <Link href="/dashboard/recruiter/orders">{t('commerce.orders')}</Link>}
                  <div className={styles.accountResources}>{!isRecruiter && <Link href="/explore/companies">{t('companiesStat')}</Link>}<Link href="/news">{t('landing.insights')}</Link>{isRecruiter && <Link href="/employers">{t('employers.badge')}</Link>}</div>
                  <button type="button" onClick={async () => { if (!await allowEmployerContextChange()) return; await logout(); window.location.href = localeHref('/'); }}>{t('logout')}</button>
                </div>}
              </div> : <><Link href="/settings" className="nav-user" title={t('settings')}>
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
              </button></>}
            </div>
          )}
          {isLanding && !isOnboarding && <button ref={menuButtonRef} className={styles.menuButton} type="button" aria-label={t('landing.menu')} aria-expanded={menuOpen} aria-controls="landing-mobile-menu" onClick={() => setMenuOpen((value) => !value)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d={menuOpen ? 'm6 6 12 12M6 18 18 6' : 'M3 5h18M3 12h18M3 19h18'} /></svg></button>}
        </div>
        {isLanding && menuOpen && <div id="landing-mobile-menu" className={styles.mobileMenu} onClick={() => setMenuOpen(false)}>{browseLinks.map(([href, key]) => <Link href={href} key={href}>{t(key)}</Link>)}{!session && <><Link href={isEmployerContext ? '/' : '/employers'}>{t(isEmployerContext ? 'employers.seekers' : 'recruiterHeroBadge')}</Link><AuthLink href="/login" accountRole={accountRole}>{t(isEmployerContext ? 'employers.login' : 'login')}</AuthLink><AuthLink href="/register" accountRole={accountRole} next={isEmployerContext ? '/dashboard/recruiter?tab=jobs&focus=create' : undefined}>{t(isEmployerContext ? 'postAJob' : 'home.createProfile')}</AuthLink></>}</div>}
      </nav>
    </div>
  );
}

export function SiteNav() {
  return <Suspense fallback={<div className="nav-wrap" style={{ minHeight: 80 }} />}><SiteNavContent /></Suspense>;
}
