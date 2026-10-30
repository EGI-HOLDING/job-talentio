'use client';

import { Link } from '@/lib/navigation';
import { useEffect, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { sanitizeMojibake } from '@/lib/text';
import { localizedJobLocation } from '@/lib/location';
import { useI18n } from '@/lib/i18n';
import { ExploreSection } from '@/components/explore/ExploreSection';
import { PromotionBadge } from '@/components/jobs/PromotionBadge';
import { usePromotionRefresh } from '@/lib/usePromotionRefresh';
import type { JobPromotion } from '@job-talentio/shared';

type RecommendedJob = {
  promotion?: JobPromotion | null;
  id: string;
  title: string;
  company: { name: string; logoUrl?: string | null; slug: string };
  city?: { name: string } | null;
  workMode?: string | null;
};

type RecommendedItem = {
  job: RecommendedJob;
};

type ProfileSignal = {
  headline?: string | null;
  desiredPosition?: string | null;
  skills?: unknown[];
  experiences?: Array<{ title?: string | null }>;
};

function hasMatchSignal(profile: ProfileSignal | null): boolean {
  if (!profile) return false;
  if ((profile.skills?.length ?? 0) > 0) return true;
  if (profile.headline?.trim() || profile.desiredPosition?.trim()) return true;
  return (profile.experiences ?? []).some((row) => Boolean(row.title?.trim()));
}

const HOME_FOR_YOU_LIMIT = 6;

export function ForYouJobsSection() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<RecommendedItem[]>([]);
  const [profile, setProfile] = useState<ProfileSignal | null>(null);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [identity, setIdentity] = useState(() => getSession()?.user.id);
  useEffect(() => {
    const changed = () => { setIdentity(getSession()?.user.id); setItems([]); setProfile(null); setReady(false); setRetry(value => value + 1); };
    window.addEventListener('jt-session-updated', changed); window.addEventListener('storage', changed);
    return () => { window.removeEventListener('jt-session-updated', changed); window.removeEventListener('storage', changed); };
  }, []);
  usePromotionRefresh(items.map(item => item.job), () => setRetry(value => value + 1));

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<RecommendedItem[]>('/jobs/recommended?limit=6').catch(() => [] as RecommendedItem[]),
      api<ProfileSignal>('/profiles/me').catch(() => null),
    ]).then(([rows, me]) => {
      if (cancelled) return;
      setItems(Array.isArray(rows) ? rows.slice(0, HOME_FOR_YOU_LIMIT) : []);
      setProfile(me);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [locale, retry, identity]);

  const emptyCopy = hasMatchSignal(profile) ? (
    <>
      {t('emp.recommendedEmptyNoOverlap')}{' '}
      <Link href="/jobs">{t('jobs')}</Link>
    </>
  ) : (
    <>
      {t('emp.recommendedEmpty')}{' '}
      <Link href="/dashboard/employee?tab=profile">{t('profile')}</Link>
    </>
  );

  return (
    <ExploreSection
      title={t('home.forYou')}
      subtitle={t('home.forYouSubtitle')}
      viewAllHref="/jobs?mode=for-you&sort=match"
      viewAllLabel={t('viewAll')}
      bare
    >
      {!ready ? (
        <div className="muted" style={{ minHeight: '2.5rem' }} />
      ) : items.length === 0 ? (
        <p className="muted">{emptyCopy}</p>
      ) : (
        <div className="grid-2">
          {items.map((item) => {
            return (
              <div
                key={item.job.id} data-job-impression={item.job.id}
                className="card job-card"
                style={{ margin: 0, gridTemplateColumns: '56px 1fr auto' }}
              >
                <Link href={`/jobs/${item.job.id}`} className="company-logo-tile" aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="company-logo"
                    src={
                      item.job.company.logoUrl ||
                      `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(item.job.company.name || 'Co')}`
                    }
                    alt=""
                  />
                </Link>
                <div>
                  <Link href={`/jobs/${item.job.id}`}>
                    <h3 style={{ margin: 0 }}>{sanitizeMojibake(item.job.title)}</h3>
                  </Link>
                  <div className="job-meta">
                    <span>{item.job.company.name}</span>
                    <PromotionBadge promotion={item.job.promotion} />
                    <span>{localizedJobLocation(item.job, t)}</span>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </ExploreSection>
  );
}
