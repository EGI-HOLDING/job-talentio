'use client';

import { Link, usePathname } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { LandingFooter } from './home/LandingFooter';
import { Suspense } from 'react';
import { useAccountRole } from '@/lib/useAccountRole';
import { EMPLOYER_JOBS, isEmployerRole } from '@/lib/accountNavigation';
import insightsStyles from './news/CareerInsights.module.css';

function SiteFooterContent() {
  const { t } = useI18n();
  const pathname = usePathname();
  const isRecruiter = isEmployerRole(useAccountRole());
  const jobsHref = isRecruiter ? EMPLOYER_JOBS : '/jobs';
  if (pathname.startsWith('/onboarding/')) return null;
  if (pathname === '/jobs' || pathname === '/explore/companies') return null;
  if (pathname === '/dashboard/employee' || pathname === '/dashboard/employee/resume-builder') return null;
  if (pathname === '/messages' || pathname === '/settings' || pathname.startsWith('/dashboard/recruiter') || pathname.startsWith('/billing/') || pathname === '/talent' || pathname.startsWith('/candidates/')) return null;
  if (pathname === '/employers') return <LandingFooter employer />;
  if (pathname === '/' && !isRecruiter) return <LandingFooter />;
  if (!/^\/(dashboard|settings|messages|talent|candidates|billing)(\/|$)/.test(pathname)) return <footer className={insightsStyles.footer}><div className={insightsStyles.footerInner}><Link href={isRecruiter ? EMPLOYER_JOBS : '/'} className={insightsStyles.footerBrand}>Job Talentio</Link><nav className={insightsStyles.footerLinks} aria-label={t('footer')}><Link href={jobsHref}>{t(isRecruiter ? 'jobs' : 'home.findJobs')}</Link><Link href="/terms">{t('termsOfService')}</Link><Link href="/privacy">{t('privacyPolicy')}</Link></nav></div></footer>;
  return (
    <footer className="footer">
      <div className="shell" style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>
          © {new Date().getFullYear()} {t('footer')}
        </span>
        <nav style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }} aria-label="Footer">
          <Link href={jobsHref}>{t('jobs')}</Link>
          <Link href="/news">{t('news')}</Link>
          <Link href="/terms">{t('termsOfService')}</Link>
          <Link href="/privacy">{t('privacyPolicy')}</Link>
        </nav>
      </div>
    </footer>
  );
}

export function SiteFooter() {
  return <Suspense fallback={null}><SiteFooterContent /></Suspense>;
}
