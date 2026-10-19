'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/lib/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatNewsDate, NEWS_CATEGORY_LABEL_KEY } from '@/components/news/NewsCard';
import { JobsIcon } from '@/components/jobs/JobsIcon';
import type { NewsCategoryKey, NewsListItem } from '@/lib/newsSeo';
import s from '@/components/news/CareerInsights.module.css';

const CATEGORIES: NewsCategoryKey[] = ['CAREER', 'INSIGHT', 'EVENT', 'EDUCATION'];
const PAGE_SIZE = 12;
type NewsListResponse = { items: NewsListItem[]; total: number; page: number; limit: number; totalPages: number };

function ArticleMeta({ item }: { item: NewsListItem }) {
  const { t, locale } = useI18n();
  return <div className={s.meta}><span className={s.category}>{t(NEWS_CATEGORY_LABEL_KEY[item.category])}</span><time dateTime={item.publishedAt}>{formatNewsDate(item.publishedAt, locale)}</time></div>;
}

function ArticleImage({ item, lead = false }: { item: NewsListItem; lead?: boolean }) {
  const className = lead ? s.cover : s.thumbnail;
  return item.coverUrl ? <img src={item.coverUrl} alt="" className={className} loading={lead ? 'eager' : 'lazy'} /> : <span aria-hidden="true" className={`${className} ${s.placeholder}`}><JobsIcon kind="document" /></span>;
}

function CompactStory({ item }: { item: NewsListItem }) {
  return <Link href={`/news/${item.slug}`} className={s.story}><ArticleImage item={item} /><div className={s.storyCopy}><ArticleMeta item={item} /><h3>{item.title}</h3></div></Link>;
}

export function NewsListClient() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramCategory = searchParams.get('category');
  const category: NewsCategoryKey | null = CATEGORIES.includes(paramCategory as NewsCategoryKey) ? paramCategory as NewsCategoryKey : null;
  const [items, setItems] = useState<NewsListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [appending, setAppending] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (pageToLoad: number, append: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(!append);
    setAppending(append);
    setError(false);
    if (!append) { setItems([]); setPage(1); setTotalPages(1); }
    try {
      const params = new URLSearchParams({ page: String(pageToLoad), limit: String(PAGE_SIZE) });
      if (category) params.set('category', category);
      const data = await api<NewsListResponse>(`/news?${params}`, { auth: false, signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems((previous) => [...new Map((append ? [...previous, ...data.items] : data.items).map((item) => [item.slug, item])).values()]);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) { setLoading(false); setAppending(false); }
    }
  }, [category, locale]);

  useEffect(() => {
    void load(1, false);
    return () => request.current?.abort();
  }, [load]);

  const tabs = [
    { value: null, label: t('discovery.allArticles') },
    { value: 'CAREER', label: t('newsCatCareer') },
    { value: 'INSIGHT', label: t('discovery.insightsTab') },
    { value: 'EVENT', label: t('discovery.eventsTab') },
    { value: 'EDUCATION', label: t('newsCatEducation') },
  ] as const;
  function chooseCategory(next: NewsCategoryKey | null) {
    router.replace(next ? `/news?category=${next}` : '/news', { scroll: false });
  }
  const lead = items[0];
  const latest = items.slice(1, 4);
  const more = items.slice(4);

  return <div className={s.page}>
    <div className={s.container}>
      <h1 className="sr-only">{t('landing.insights')}</h1>
      <div className={s.tabs} role="tablist" aria-label={t('landing.insights')}>
        {tabs.map((tab, index) => <button key={tab.value || 'all'} type="button" role="tab" id={`insights-tab-${tab.value || 'all'}`} aria-selected={category === tab.value} aria-controls="insights-articles" tabIndex={category === tab.value ? 0 : -1} onClick={() => chooseCategory(tab.value)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          const next = tabs[nextIndex];
          document.getElementById(`insights-tab-${next.value || 'all'}`)?.focus();
          chooseCategory(next.value);
        }}>{tab.label}</button>)}
      </div>
      <div id="insights-articles" role="tabpanel" aria-labelledby={`insights-tab-${category || 'all'}`} aria-busy={loading || appending}>
        {loading ? <div className={s.skeleton} role="status" aria-label={t('ui.loading')}><span /><span /></div> : error && !items.length ? <div className={s.message} role="alert">{t('discovery.newsError')}<button className={s.loadButton} type="button" onClick={() => void load(1, false)}>{t('workspace.retry')}</button></div> : !lead ? <p className={s.message}>{t('newsEmpty')}</p> : <>
          <div className={`${s.leadGrid} ${latest.length ? '' : s.soloLead}`}>
            <article className={s.lead}><Link href={`/news/${lead.slug}`} className={s.leadLink}>
              <ArticleImage item={lead} lead /><ArticleMeta item={lead} /><h2>{lead.title}</h2><p>{lead.excerpt}</p><span className={s.read}>{t('discovery.readArticle')}<JobsIcon kind="back" /></span>
            </Link></article>
            {!!latest.length && <section className={s.latest} aria-labelledby="latest-articles"><h2 id="latest-articles">{t('discovery.latest')}</h2>{latest.map((item) => <CompactStory key={item.slug} item={item} />)}</section>}
          </div>
          {!!more.length && <section className={s.more} aria-labelledby="more-articles"><h2 id="more-articles">{t('discovery.exploreMore')}</h2><div className={s.moreGrid}>{more.map((item) => <CompactStory key={item.slug} item={item} />)}</div></section>}
          {error && <div className={s.appendError} role="alert">{t('discovery.newsError')}<button type="button" onClick={() => void load(page + 1, true)}>{t('workspace.retry')}</button></div>}
          {page < totalPages && !error && <div className={s.loadMore}><button type="button" className={s.loadButton} disabled={appending} onClick={() => void load(page + 1, true)}>{appending ? t('ui.loading') : t('discovery.loadMore')}</button></div>}
        </>}
      </div>
    </div>
  </div>;
}
