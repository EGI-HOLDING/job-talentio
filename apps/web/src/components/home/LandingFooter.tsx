'use client';

import { Link } from '@/lib/navigation';
import { useI18n, type Locale } from '@/lib/i18n';
import s from './LandingFooter.module.css';
import { useAccountRole } from '@/lib/useAccountRole';
import { isEmployerRole } from '@/lib/accountNavigation';

export function LandingFooter({ employer = false }: { employer?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  const signedInEmployer = isEmployerRole(useAccountRole());
  const groups = employer ? [
    signedInEmployer
      ? [['/dashboard/recruiter?tab=jobs', 'jobs'], ['/dashboard/recruiter?tab=jobs&focus=create', 'postAJob'], ['/dashboard/recruiter?tab=company', 'company']]
      : [['/employers#find-talent', 'postAJob'], ['/register?role=RECRUITER&next=%2Fdashboard%2Frecruiter%3Ftab%3Djobs%26focus%3Dcreate', 'postAJob'], ['/login?role=RECRUITER', 'employers.login']],
    [['/employers#hiring-insights', 'employers.insights'], ['/terms', 'termsOfService'], ['/privacy', 'privacyPolicy']],
    signedInEmployer ? [['/dashboard/recruiter?tab=jobs', 'jobs']] : [['/', 'employers.seekers']],
  ] : [
    [['/jobs', 'home.findJobs'], ['/explore/companies', 'companiesStat'], ['/news', 'landing.insights']],
    [['/explore/categories', 'landing.field'], ['/explore/cities', 'landing.locations'], ['/explore/titles', 'landing.roles']],
    [['/employers', 'recruiterHeroBadge'], ['/terms', 'termsOfService'], ['/privacy', 'privacyPolicy']],
  ];
  return <footer className={s.footer}>
    <div className={s.inner}>
      <div className={s.top}><div className={s.identity}><Link href={employer ? '/employers' : '/'} className={s.brand}>Job Talentio</Link><p>{t('landing.mission')}</p></div>
        <nav className={s.links} aria-label={t('landing.footerNav')}>{groups.map((group, index) => <div key={index}>{group.map(([href, key]) => <Link href={href} key={href}>{t(key)}</Link>)}</div>)}</nav>
      </div>
      <div className={s.bottom}><span>© {new Date().getFullYear()} Job Talentio</span><div className={s.languages} aria-label={t('language')}>{(['en', 'ru', 'uz', 'id'] as Locale[]).map((item) => <button key={item} type="button" onClick={() => setLocale(item)} aria-pressed={locale === item}>{item.toUpperCase()}</button>)}</div></div>
    </div>
  </footer>;
}
