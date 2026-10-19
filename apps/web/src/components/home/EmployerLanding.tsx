'use client';

import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useRouter } from '@/lib/navigation';
import { api, getSession } from '@/lib/api';
import { authLink } from '@/lib/authReturn';
import { useI18n } from '@/lib/i18n';
import { HeroLocationPicker } from './HeroLocationPicker';
import { LandingIcon } from './LandingSections';
import type { TopCompany } from './TopCompaniesCarousel';
import type { NewsListItem } from '@/lib/newsSeo';
import { NEWS_CATEGORY_LABEL_KEY } from '@/components/news/NewsCard';
import hero from './SeekerHero.module.css';
import sections from './LandingSections.module.css';
import s from './EmployerLanding.module.css';

type City = { slug: string; name: string; country?: string; countrySlug?: string };
type CityMeta = { slug: string; name: string; province?: { country?: { slug: string; name: string } } };

const FIELDS = ['it-software', 'sales-marketing', 'finance', 'design', 'customer-support', 'engineering', 'logistics', 'hospitality'];
// Use searchable candidate keywords; the existing talent search has no category filter.
const FIELD_SEARCH: Record<string, string> = {
  'it-software': 'software', 'sales-marketing': 'sales', finance: 'account', design: 'design',
  'customer-support': 'support', engineering: 'engineer', logistics: 'logistics', hospitality: 'hotel',
};
const POPULAR = [
  { key: 'home.popularFrontend', slug: 'frontend-developer' },
  { key: 'home.popularSales', slug: 'sales-manager' },
  { key: 'home.popularAccountant', slug: 'accountant' },
];
const POST_JOB = '/dashboard/recruiter?tab=jobs&focus=create';

export function EmployerLanding() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [cities, setCities] = useState<City[]>([]);
  const [categories, setCategories] = useState<Array<{ slug: string; name: string }>>([]);
  const [companies, setCompanies] = useState<TopCompany[]>([]);
  const [news, setNews] = useState<NewsListItem[]>([]);
  const [recruiter, setRecruiter] = useState(false);

  useEffect(() => {
    let active = true;
    setRecruiter(getSession()?.user.role === 'RECRUITER');
    api<CityMeta[]>('/meta/cities', { auth: false }).then((items) => {
      if (active) setCities(items.map((city) => ({ slug: city.slug, name: city.name, country: city.province?.country?.name, countrySlug: city.province?.country?.slug })));
    }).catch(() => undefined);
    api<Array<{ slug: string; name: string }>>('/meta/categories', { auth: false }).then((items) => {
      if (active) setCategories(FIELDS.flatMap((slug) => items.filter((item) => item.slug === slug)));
    }).catch(() => undefined);
    api<{ items: TopCompany[] }>('/companies?plan=VIP&limit=5&sort=jobs', { auth: false }).then((data) => {
      if (active) setCompanies(data.items || []);
    }).catch(() => undefined);
    api<{ items: NewsListItem[] }>('/news?category=INSIGHT&limit=3', { auth: false }).then((data) => {
      if (active) setNews(data.items || []);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [locale]);

  // Public calls to action keep their intended destination through employer auth.
  const talentHref = (destination = '/talent') => recruiter ? destination : authLink('/login', destination, 'RECRUITER');
  const postHref = recruiter ? POST_JOB : authLink('/register', POST_JOB, 'RECRUITER');

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const query = String(data.get('q') || '').trim();
    const location = String(data.get('location') || '');
    const city = location.startsWith('country:')
      ? cities.filter((item) => item.countrySlug === location.slice(8)).map((item) => item.slug).join(',')
      : location;
    if (query) params.set('q', query);
    if (city) params.set('city', city);
    router.push(talentHref(`/talent${params.size ? `?${params}` : ''}`));
  }

  return <div className={hero.page}><div className={hero.shell}>
    <section id="find-talent" className={`${hero.hero} ${s.hero}`} aria-labelledby="employer-title">
      <Image src="/images/talentio-employer-hero-hd.webp" alt="" fill priority quality={95}
        sizes="(max-width: 760px) 1800px, (max-width: 1608px) calc(100vw - 3rem), 1560px" className={`${hero.photo} ${s.photo}`} />
      <div className={`${hero.overlay} ${s.overlay}`} aria-hidden="true" />
      <div className={`${hero.content} ${s.content}`}>
        <p className={hero.eyebrow}>{t('employers.eyebrow')}</p>
        <h1 id="employer-title" className={`${hero.title} ${s.title}`}><span>{t('employers.title1')}</span><span>{t('employers.title2')}</span></h1>
        <p className={`${hero.subtitle} ${s.subtitle}`}><span>{t('employers.subtitle1')}</span><span>{t('employers.subtitle2')}</span></p>
        <Link className={s.heroPost} href={postHref}>{t('postAJob')}<LandingIcon /></Link>
      </div>
      <form className={hero.search} role="search" aria-label={t('employers.search')} onSubmit={search}>
        <label className={hero.queryField}><LandingIcon kind="search" /><span className="sr-only">{t('employers.searchPlaceholder')}</span><input type="search" name="q" placeholder={t('employers.searchPlaceholder')} /></label>
        <div className={hero.cityField}><HeroLocationPicker cities={cities} /></div>
        <button type="submit" className={hero.searchButton}>{t('employers.search')}<LandingIcon /></button>
      </form>
      <div className={hero.popular}><span>{t('home.popular')}</span>{POPULAR.map((role) => <Link key={role.slug} href={talentHref(`/talent?jobTitle=${role.slug}`)}>{t(role.key)}</Link>)}</div>
    </section>

    {companies.length > 0 && <section className={`${hero.employers} ${s.trust}`} aria-labelledby="employer-companies">
      <div className={hero.employersHeading}><h2 id="employer-companies">{t('employers.companies')}</h2></div>
      <div className={hero.companyRow}>{companies.map((company) => <Link className={hero.company} key={company.slug} href={`/companies/${company.slug}`}>
        {company.logoUrl && <img src={company.logoUrl} alt="" width="56" height="56" loading="lazy" />}<span>{company.name}</span>
      </Link>)}</div>
    </section>}

    <div className={`${sections.sections} ${s.sections}`}>
      <section aria-labelledby="employer-fields">
        <div className={sections.heading}><div><h2 id="employer-fields">{t('employers.field')}</h2><p>{t('employers.fieldSub')}</p></div><Link href={talentHref()}>{t('employers.browse')}<LandingIcon /></Link></div>
        <div className={`${sections.categories} ${s.categories}`}>{categories.map((category) => <Link className={sections.category} key={category.slug} href={talentHref(`/talent?q=${encodeURIComponent(FIELD_SEARCH[category.slug] || category.name)}`)}>
          <LandingIcon kind={category.slug} /><div><h3>{category.name}</h3><span>{t('employers.explore')}{' \u2192'}</span></div>
        </Link>)}</div>
        <p className={s.privacy}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 1 1 8 0v4m-4 5v2" /></svg>{t('employers.private')}</p>
      </section>

      <section id="how-it-works" className={`${sections.candidate} ${s.onboarding}`} aria-labelledby="employer-start">
        <div className={sections.candidateCopy}><span className={sections.eyebrow}>{t('employers.growing')}</span><h2 id="employer-start">{t('employers.start')}</h2><p>{t('employers.startSub')}</p><Link className={sections.primaryButton} href={postHref}>{t('postAJob')}<LandingIcon /></Link></div>
        <ol className={sections.steps}>{['person', 'briefcase', 'search'].map((icon, index) => <li key={icon}><span className={sections.stepIcon}><LandingIcon kind={icon} /></span><div><strong>{index + 1}. {t(`employers.step${index + 1}`)}</strong><span>{t(`employers.step${index + 1}Sub`)}</span></div></li>)}</ol>
        <div className={sections.cvArt} aria-hidden="true"><div className={sections.cvPaper}><div className={sections.cvHeader}><LandingIcon kind="briefcase" /></div><i /><i /><i /><i /></div></div>
      </section>

      <section className={s.workflow} aria-labelledby="employer-workflow">
        <div><h2 id="employer-workflow">{t('employers.moving')}</h2><p>{t('employers.movingSub')}</p>
          <ul className={s.features}>{['document', 'person', 'briefcase'].map((icon, index) => <li key={icon}><LandingIcon kind={icon} /><div><h3>{t(`employers.feature${index + 1}`)}</h3><p>{t(`employers.feature${index + 1}Sub`)}</p></div></li>)}</ul>
        </div>
        <figure className={s.preview} aria-labelledby="pipeline-caption"><figcaption id="pipeline-caption"><strong>{t('employers.applications')}</strong><span>{t('employers.preview')}</span></figcaption><h3>{t('employers.previewRole')}</h3>
          <div className={s.pipeline}>{['enum.applicationStatus.NEW', 'employers.shortlisted', 'enum.applicationStatus.INTERVIEW'].map((key, index) => <div className={s.stage} key={key}>
            <div className={s.stageHeading}>{t(key)}<span aria-hidden="true">{'\u00b7\u00b7\u00b7'}</span></div>
            {(index === 0 ? ['A', 'B'] : index === 1 ? ['C'] : ['D', 'E']).map((letter) => <div className={s.sample} key={letter}><span className={s.sampleAvatar} aria-hidden="true"><LandingIcon kind="person" /></span><div><strong>{t('employers.candidate')} {letter}</strong><small>{t('employers.previewRole')}</small></div></div>)}
          </div>)}</div>
        </figure>
      </section>

      {<section id="hiring-insights" aria-labelledby="employer-insights"><div className={sections.heading}><div><h2 id="employer-insights">{t('employers.insights')}</h2><p>{t('employers.insightsSub')}</p></div><Link href="/news">{t('landing.allArticles')}<LandingIcon /></Link></div>
        {!news.length && <p className={s.articleEmpty}>{t('employers.insightsSub')} <Link href="/news">{t('landing.allArticles')} →</Link></p>}<div className={sections.news}>{news.map((item) => <Link className={sections.article} key={item.slug} href={`/news/${item.slug}`}>
          {item.coverUrl && <img src={item.coverUrl} alt="" loading="lazy" />}<div className={sections.articleBody}><div className={sections.articleMeta}><span className={sections.badge}>{t(NEWS_CATEGORY_LABEL_KEY[item.category])}</span></div><h3>{item.title}</h3><span className={`${sections.readMore} ${s.articleLink}`}>{t('readMore')}<LandingIcon /></span></div>
        </Link>)}</div>
      </section>}

      <section className={`${sections.employer} ${s.closing}`}><LandingIcon kind="briefcase" /><div><h2>{t('employers.ready')}</h2><p>{t('employers.readySub')}</p></div><div className={s.closingActions}><Link href={postHref} className={sections.primaryButton}>{t('postAJob')}<LandingIcon /></Link><Link href={authLink('/login', null, 'RECRUITER')} className={sections.outlineButton}>{t('employers.login')}</Link></div></section>
    </div>
  </div></div>;
}
