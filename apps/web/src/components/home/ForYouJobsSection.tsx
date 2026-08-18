'use client';

import { Link } from '@/lib/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { sanitizeMojibake } from '@/lib/text';
import { localizedJobLocation } from '@/lib/location';
import { useI18n } from '@/lib/i18n';
import { ExploreSection } from '@/components/explore/ExploreSection';
import { MatchRing } from '@/components/ui/MatchRing';
import { MatchBreakdownPanel, type MatchBreakdownData } from '@/components/ui/MatchBreakdownPanel';

type RecommendedJob = {
  id: string;
  title: string;
  company: { name: string; logoUrl?: string | null; slug: string };
  city?: { name: string } | null;
  workMode?: string | null;
};

type RecommendedItem = {
  job: RecommendedJob;
  matchScore?: number | null;
  matchBreakdown?: MatchBreakdownData | null;
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
  const { t } = useI18n();
  const [items, setItems] = useState<RecommendedItem[]>([]);
  const [profile, setProfile] = useState<ProfileSignal | null>(null);
  const [ready, setReady] = useState(false);
  const [breakdownId, setBreakdownId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<RecommendedItem[]>('/jobs/recommended').catch(() => [] as RecommendedItem[]),
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
  }, []);

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
      viewAllHref="/jobs?sort=match"
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
            const rowId = `home-rec-${item.job.id}`;
            const open = breakdownId === rowId;
            return (
              <div
                key={item.job.id}
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
                    <span>{localizedJobLocation(item.job, t)}</span>
                  </div>
                  {item.matchScore != null && item.matchBreakdown && (
                    <>
                      <button
                        type="button"
                        className="badge match"
                        style={{ marginTop: '0.55rem', border: 0, cursor: 'pointer' }}
                        onClick={() => setBreakdownId(open ? null : rowId)}
                      >
                        {t('match')} {item.matchScore}% | {t('emp.details')}
                      </button>
                      {open && (
                        <MatchBreakdownPanel
                          breakdown={item.matchBreakdown}
                          style={{ marginTop: '0.5rem' }}
                        />
                      )}
                    </>
                  )}
                </div>
                {item.matchScore != null ? <MatchRing score={item.matchScore} size="sm" /> : <div />}
              </div>
            );
          })}
        </div>
      )}
    </ExploreSection>
  );
}
