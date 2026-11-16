'use client';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { useLiveRefresh } from '@/lib/useLiveRefresh';
import { useApplicationPresentation } from './screening/ApplicationPresentation';

import { Link, localeHref, usePathname, useRouter } from '@/lib/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ADMIN_URL, api, getSession, logout, AuthSession } from '@/lib/api';
import { useI18n, Locale } from '@/lib/i18n';
import styles from './SiteNav.module.css';
import { AuthLink } from './auth/AuthLink';
import { authRoleFrom } from '@/lib/authReturn';
import { EMPLOYER_LANDING_PREVIEW, SEEKER_JOBS_PREVIEW, employerWorkspaceHref, isCandidateReviewPath, isSeekerJobsPreview } from '@/lib/accountNavigation';
import { preferredCompany, rememberCompany } from './recruiter/RecruiterPrimitives';
import { WorkspaceIcon } from './employee/WorkspaceIcon';
import { allowEmployerContextChange } from './recruiter/useEmployerUnsaved';
import { useHrAssistantContext, useHrFlowContext } from './recruiter/HrFlowPresentation';
import { HrAssistantHeader } from './recruiter/HrAssistantOnboarding';

type Notif = {
  id: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
};

type Notifications = { accountId: string; unread: number; items: Notif[] };

const LOCALE_LABELS: Record<Locale, string> = { uz: "O'z", ru: 'Ру', en: 'En', id: 'ID' };
const AUDIENCE_LABELS: Record<Locale, { group: string; seekers: string; employers: string }> = {
  id: { group: 'Pilih tujuan', seekers: 'Cari kerja', employers: 'Cari pelamar' },
  en: { group: 'Choose a destination', seekers: 'Find a job', employers: 'Find candidates' },
  ru: { group: 'Выберите раздел', seekers: 'Найти работу', employers: 'Найти кандидатов' },
  uz: { group: 'Bo‘limni tanlang', seekers: 'Ish topish', employers: 'Nomzod topish' },
};

function SiteNavContent() {
  const hrCompany = useHrFlowContext();
  const assistant = useHrAssistantContext();
  const { locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [companies, setCompanies] = useState<Array<{companyId: string; company: {name: string}}>>([]);
  const [rememberedCompany, setRememberedCompany] = useState('');
  const searchParams = useSearchParams();
  const [session, setSession] = useState<AuthSession | null>();
  const [notifications, setNotifications] = useState<Notifications | null>(null);
  const accountId = session?.user.id;
  const currentNotifications = notifications?.accountId === accountId ? notifications : null;
  const unread = currentNotifications?.unread ?? 0;
  const notifs = currentNotifications?.items ?? [];
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const languageButtonRef = useRef<HTMLButtonElement>(null);
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
  }, [Boolean(assistant)]);

  useEffect(() => {
    const refreshSession = () => setSession(getSession());
    refreshSession();
    window.addEventListener('jt-session-updated', refreshSession);
    window.addEventListener('storage', refreshSession);
    return () => { window.removeEventListener('jt-session-updated', refreshSession); window.removeEventListener('storage', refreshSession); };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
    setOpen(false);
    setLangOpen(false);
  }, [pathname, searchParams, locale, accountId]);
  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (accountOpen) { setAccountOpen(false); accountButtonRef.current?.focus(); }
      else if (open) { setOpen(false); notificationButtonRef.current?.focus(); }
      else if (langOpen) { setLangOpen(false); languageButtonRef.current?.focus(); }
      else if (menuOpen) { setMenuOpen(false); menuButtonRef.current?.focus(); }
      else return;
      event.preventDefault();
    }
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [menuOpen, accountOpen, open, langOpen]);

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
    const controller = new AbortController();
    let loading = false;
    let loaded = false;
    async function loadCompanies() {
      if (loading || loaded) return;
      loading = true;
      try {
        const mine = await api<Array<{companyId: string; company: {name: string}}>>('/companies/mine', { signal: controller.signal });
        if (controller.signal.aborted) return;
        loaded = mine.length > 0;
        setCompanies(mine);
        setRememberedCompany(preferredCompany(mine)?.companyId || '');
      } catch {
        // Retry when the workspace next selects a company.
      } finally {
        loading = false;
      }
    }
    void loadCompanies();
    window.addEventListener('talentio:company', loadCompanies);
    return () => {
      controller.abort();
      window.removeEventListener('talentio:company', loadCompanies);
    };
  }, [session?.user.id, session?.user.role]);

  useEffect(() => {
    const update = () => setRememberedCompany(preferredCompany(companies)?.companyId || '');
    window.addEventListener('talentio:company', update);
    return () => window.removeEventListener('talentio:company', update);
  }, [companies]);

  const noticeRequest = useRef(0);
  const refreshNotifs = useCallback(async (showList: boolean) => {
    if (!accountId || accountId !== getSession()?.user.id) return;
    const sequence = ++noticeRequest.current;
    if (showList) {
      const data = await api<{items:Notif[];unread:number}>('/notifications');
      if (sequence !== noticeRequest.current || accountId !== getSession()?.user.id) return;
      setNotifications({ accountId, items: data.items, unread: data.unread });
    } else {
      const data = await api<{count:number}>('/notifications/unread-count');
      if (sequence !== noticeRequest.current || accountId !== getSession()?.user.id) return;
      setNotifications(current => ({ accountId, unread: data.count, items: current?.accountId === accountId ? current.items : [] }));
    }
  }, [accountId]);
  useEffect(() => {
    void refreshNotifs(false).catch(() => undefined);
    return () => { ++noticeRequest.current; };
  }, [refreshNotifs]);
  useLiveRefresh('notifications', () => refreshNotifs(open), Boolean(accountId), locale + ':' + accountId);
  async function toggleNotifs() {
    if (!session) return;
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        await refreshNotifs(true);
      } catch {
        /* ignore */
      }
    }
  }

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' });
    if (accountId !== getSession()?.user.id) return;
    ++noticeRequest.current;
    const readAt = new Date().toISOString();
    setNotifications(current => current && current.accountId === accountId
      ? { ...current, unread: 0, items: current.items.map(n => ({ ...n, readAt: n.readAt || readAt })) }
      : current);
  }

  async function chooseLocale(l: Locale) {
    if (!await allowEmployerContextChange()) return;
    setLocale(l);
    setLangOpen(false);
    if (session) {
      api('/auth/me', { method: 'PATCH', body: JSON.stringify({ locale: l }) }).catch(() => undefined);
    }
  }

  const requestedCompany = searchParams.get('company');
  const activeCompany = companies.find(item => item.companyId === requestedCompany) || companies.find(item => item.companyId === rememberedCompany) || companies[0];
  const companyHref = '/dashboard/recruiter?tab=company' + (activeCompany ? '&company=' + encodeURIComponent(activeCompany.companyId) : '');

  const isOnboarding = pathname.startsWith('/onboarding/');
  const inApplication = pathname.startsWith('/apply/');
  const hrFlow = hrCompany !== null || (process.env.NEXT_PUBLIC_HR_CREATION_V2 === 'true' || process.env.NEXT_PUBLIC_PRIVACY_MARKET === 'id') && pathname === '/onboarding/recruiter';
  const isRecruiter = session?.user.role === 'RECRUITER';
  const candidateReview = Boolean(session && (isRecruiter || session.user.role === 'SUPER_ADMIN') &&
    isCandidateReviewPath(pathname));
  const isEmployee = session?.user.role === 'EMPLOYEE';
  const isJobs = pathname === '/jobs' || pathname.startsWith('/jobs/');
  const isPublic = !/^\/(dashboard|settings|messages|talent|candidates|billing)(\/|$)/.test(pathname);
  const isEmployerContext = pathname === '/employers' || pathname === '/pricing' || (/^\/(login|register|forgot-password|reset-password)$/.test(pathname) && (searchParams.get('role') === 'RECRUITER' || Boolean(searchParams.get('invite'))));
  const accountRole = isEmployerContext ? 'RECRUITER' : authRoleFrom(searchParams.get('role'));
  const isLanding = isEmployee || isRecruiter || (isPublic && isEmployerContext) || (isPublic && !session);
  const isDiscovery = isEmployee || isRecruiter || (isLanding && pathname !== '/' && pathname !== '/employers');
  const seekerPreview = isRecruiter && ((pathname === '/' || isJobs) && searchParams.get('audience') === 'seekers'
    || isJobs && isSeekerJobsPreview(searchParams.get('returnTo')));
  const employerSide = isEmployerContext || (isRecruiter && !seekerPreview);
  const showAudienceToggle = session === null && isLanding
    && !hrFlow && !candidateReview && !isOnboarding && !inApplication;
  const seekerHref = isRecruiter ? SEEKER_JOBS_PREVIEW : isEmployee ? '/jobs' : '/';
  const employerHref = isRecruiter ? employerWorkspaceHref('jobs', activeCompany?.companyId) : isEmployee ? EMPLOYER_LANDING_PREVIEW : '/employers';
  const employeeTab = searchParams.get('tab');
  const recruiterTab = searchParams.get('tab') || 'jobs';
  const recruiterActive = [(pathname === '/dashboard/recruiter' && ['jobs', 'pipeline', 'bulk'].includes(recruiterTab)) || pathname.startsWith('/dashboard/recruiter/jobs/') || pathname.startsWith('/jobs/') || pathname.startsWith('/candidates/'), pathname === '/messages', pathname === '/dashboard/recruiter' && recruiterTab === 'analytics'];
  const publicEmployerPage = isEmployerContext && (!isRecruiter || pathname === '/employers');
  const browseLinks = isOnboarding || inApplication
    ? [['/jobs', 'home.findJobs']]
    : seekerPreview
    ? [[SEEKER_JOBS_PREVIEW, 'home.findJobs']]
    : publicEmployerPage
    ? []
    : isRecruiter
    ? [['/dashboard/recruiter?tab=jobs', 'jobs'], ['/messages?role=RECRUITER', 'messages'], ['/dashboard/recruiter?tab=analytics', 'rec.tabAnalytics']]
    : isEmployee
    ? [['/jobs', 'home.findJobs'], ['/dashboard/employee?tab=applications', 'applications'], ['/dashboard/employee?tab=saved', 'savedJobs'], ['/messages', 'messages']]
    : [['/jobs', 'home.findJobs']];
  const activeBrowseLinks = isOnboarding || inApplication || publicEmployerPage ? []
    : seekerPreview ? [isJobs]
    : isRecruiter ? recruiterActive
    : [isJobs, pathname === '/dashboard/employee' && employeeTab === 'applications', pathname === '/dashboard/employee' && employeeTab === 'saved', pathname === '/messages'];
  const showMobileMenu = isLanding && !isOnboarding && !hrFlow && !candidateReview
    && (browseLinks.length > 0 || !session);
  const dash =
    session?.user.role === 'EMPLOYEE'
      ? '/jobs?mode=for-you'
      : isRecruiter
        ? '/dashboard/recruiter'
        : null;

  if (assistant) return <div ref={navWrapRef} data-hr-header data-hr-assistant-nav><HrAssistantHeader {...assistant} /></div>;

  return (
    <div ref={navWrapRef} data-hr-header={hrFlow || undefined} className={`nav-wrap ${hrFlow ? styles.hrFlow : ''} ${isLanding ? styles.landing : ''} ${isDiscovery ? styles.jobs : ''} ${isEmployee ? styles.employee : ''} ${isRecruiter ? styles.recruiter : ''} ${candidateReview ? styles.candidateReview : ''}`}>
      <nav className={`nav shell ${isLanding ? styles.landingNav : ''}`}>
        <div className={isLanding ? styles.primary : undefined}>
        <Link href={employerSide ? employerHref : seekerHref} className={`brand ${styles.logoLink} ${isLanding ? styles.brand : ''} ${employerSide ? styles.employerBrand : ''}`}>
          <img className={styles.logo} src="/brand/talentio-logo.webp" alt="Talentio" />{!candidateReview && employerSide && <small>{t('employers.badge')}</small>}
        </Link>
        {candidateReview && <span className={styles.recruitmentLabel}>{locale === 'id' ? 'Rekrutmen' : 'Recruitment'}</span>}
        {hrFlow && <span className={styles.hrCompany}><WorkspaceIcon kind="building"/><span>{hrCompany || activeCompany?.company.name || t('employers.badge')}</span></span>}
        {isLanding && !hrFlow && !candidateReview && browseLinks.length > 0 && (
          <div className={styles.browse}>
            {browseLinks.map(([href, key], index) => <Link key={href} href={href} aria-current={activeBrowseLinks[index] ? 'page' : undefined}>{t(key)}</Link>)}
          </div>
        )}
        </div>
        {showAudienceToggle && <div className={styles.audienceToggle} role="group" aria-label={AUDIENCE_LABELS[locale].group}>
          <Link className={`${styles.audienceOption} ${!employerSide ? styles.audienceActive : ''}`} href={seekerHref} aria-current={!employerSide ? 'page' : undefined}>{AUDIENCE_LABELS[locale].seekers}</Link>
          <Link className={`${styles.audienceOption} ${employerSide ? styles.audienceActive : ''}`} href={employerHref} aria-current={employerSide ? 'page' : undefined}>{AUDIENCE_LABELS[locale].employers}</Link>
        </div>}
        <div className={`nav-links ${isLanding ? styles.landingLinks : ''} ${isLanding && session ? styles.signedIn : ''}`}>
          {hrFlow && <Link className={styles.hrHelp} href={'/dashboard/recruiter/support' + (activeCompany ? '?company=' + encodeURIComponent(activeCompany.companyId) : '')}><span aria-hidden="true">ⓘ</span>{t('hr.support')}</Link>}
          {!isLanding && !candidateReview && <><Link href="/jobs">{t('jobs')}</Link>{dash && <Link href={dash}>{t('dashboard')}</Link>}</>}
          {session && !isEmployee && !isRecruiter && !candidateReview && <Link href="/messages">{t('messages')}</Link>}
          {session?.user.role === 'SUPER_ADMIN' && !candidateReview && (
            <a href={ADMIN_URL} target="_blank" rel="noreferrer">
              Admin
            </a>
          )}
          {!candidateReview && <div className={`lang-switch ${styles.language}`} ref={langRef}>
            <button
              ref={languageButtonRef}
              type="button"
              className="chip"
              aria-haspopup="listbox"
              aria-expanded={langOpen}
              aria-label={t('language')}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                setAccountOpen(false);
                setLangOpen((v) => !v);
              }}
            >
              {hrFlow ? <><span className={styles.hrLanguageFlag} data-locale={locale} aria-hidden="true"/>{LOCALE_LABELS[locale]}</> : isOnboarding && locale === 'id' ? 'Indonesia' : LOCALE_LABELS[locale]}
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
          </div>}
          {!session ? (
            <>
              <AuthLink href="/login" accountRole={accountRole}>{t(isEmployerContext ? 'employers.login' : 'login')}</AuthLink>
              <AuthLink href="/register" accountRole={accountRole} next={isEmployerContext ? '/dashboard/recruiter?tab=jobs&focus=create' : undefined} className={isLanding ? styles.register : 'chip'} style={isLanding ? undefined : { background: 'var(--accent)', color: '#fff', border: 0 }}>
                {isEmployerContext ? t('postAJob') : isLanding ? t('home.createProfile') : t('register')}
              </AuthLink>
            </>
          ) : (
            <div className="nav-user" ref={ref}>
              {!isOnboarding && !candidateReview && <div className={styles.notification}>
                <button ref={notificationButtonRef} type="button" className="notif-btn" onClick={toggleNotifs} aria-label={t('notifications')} aria-expanded={open} aria-controls="workspace-notifications">
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
                  <div id="workspace-notifications" className="notif-dropdown">
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
              {isEmployee || isRecruiter || candidateReview ? <div className={styles.account} ref={accountRef}>
                <button ref={accountButtonRef} type="button" className={styles.accountButton} aria-label={t('workspace.accountMenu')} aria-expanded={accountOpen} aria-controls="workspace-account-menu" onClick={() => { setAccountOpen((value) => !value); setOpen(false); setLangOpen(false); }}>
                  {session.user.avatarUrl ? <img className="avatar" src={session.user.avatarUrl} alt="" /> : <span className={styles.initial}>{session.user.fullName.charAt(0)}</span>}
                  <span className={styles.accountName}>{!candidateReview && !hrFlow && isRecruiter && activeCompany ? activeCompany.company.name : session.user.fullName.split(' ')[0]}</span>{!candidateReview && isRecruiter && (!session.user.email || session.user.emailVerified === false) && <i className={styles.accountAttention} title={t(session.user.email ? 'emailUnverifiedBadge' : 'addEmailTitle')} />}<DirectionalIcon direction={accountOpen ? "up" : "down"} size={14} />
                </button>
                {accountOpen && <div id="workspace-account-menu" className={styles.accountMenu}>
                  <div className={styles.accountIdentity}><strong>{session.user.fullName}</strong><span>{session.user.email}</span>{isRecruiter && (!session.user.email || session.user.emailVerified === false) && <Link className={styles.verificationLink} href="/settings?role=RECRUITER"><i />{t(session.user.email ? 'emailUnverifiedBadge' : 'addEmailTitle')}</Link>}</div>
                  {isRecruiter && companies.length > 0 && <div className={styles.companyChoices}><span>{t('company')}</span>{companies.map(item => <button key={item.companyId} type="button" aria-pressed={item.companyId === activeCompany?.companyId} onClick={async () => { if (!await allowEmployerContextChange()) return; rememberCompany(item.companyId); setRememberedCompany(item.companyId); setAccountOpen(false); router.push('/dashboard/recruiter?tab=jobs&company=' + encodeURIComponent(item.companyId)); }}><WorkspaceIcon kind="building" /><span>{item.company.name}</span>{item.companyId === activeCompany?.companyId && <WorkspaceIcon kind="check" />}</button>)}</div>}
                  {isRecruiter ? <><Link href={companyHref}>{t('rw.companyProfile')}</Link><Link href={companyHref + '&panel=promotion'}>{t('rw.promotion')}</Link></> : <><Link href="/dashboard/employee?tab=profile">{t('workspace.profileCv')}</Link><Link href="/dashboard/employee?tab=alerts">{t('workspace.jobAlerts')}</Link></>}
                  <Link href={isRecruiter ? '/settings?role=RECRUITER' : '/settings?role=EMPLOYEE'}>{t('settings')}</Link>
                  {isRecruiter && <><Link href="/dashboard/recruiter/orders">{t('commerce.orders')}</Link><Link href={'/dashboard/recruiter/support' + (activeCompany ? '?company=' + encodeURIComponent(activeCompany.companyId) : '')}>{t('hr.support')}</Link></>}
                  {isRecruiter && <div className={styles.accountResources}><Link href="/news">{t('employers.insights')}</Link><Link href="/employers">{t('employers.badge')}</Link></div>}
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
          {showMobileMenu && <button ref={menuButtonRef} className={styles.menuButton} type="button" aria-label={t('landing.menu')} aria-expanded={menuOpen} aria-controls="landing-mobile-menu" onClick={() => setMenuOpen((value) => !value)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d={menuOpen ? 'm6 6 12 12M6 18 18 6' : 'M3 5h18M3 12h18M3 19h18'} /></svg></button>}
        </div>
        {showMobileMenu && menuOpen && <div id="landing-mobile-menu" className={styles.mobileMenu} onClick={() => setMenuOpen(false)}>{browseLinks.map(([href, key], index) => <Link href={href} key={href} aria-current={activeBrowseLinks[index] ? 'page' : undefined}>{t(key)}</Link>)}{!session && <><AuthLink href="/login" accountRole={accountRole}>{t(isEmployerContext ? 'employers.login' : 'login')}</AuthLink><AuthLink href="/register" accountRole={accountRole} next={isEmployerContext ? '/dashboard/recruiter?tab=jobs&focus=create' : undefined}>{t(isEmployerContext ? 'postAJob' : 'home.createProfile')}</AuthLink></>}</div>}
      </nav>
    </div>
  );
}

export function SiteNav() {
  const { focused } = useApplicationPresentation();
  if (focused) return null;
  return <Suspense fallback={<div className="nav-wrap" style={{ minHeight: 80 }} />}><SiteNavContent /></Suspense>;
}
