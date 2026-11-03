'use client';
import { EmployeeRecommendationNotice,EmployeeMatchReasons } from '@/components/jobs/EmployeeRecommendationState';
import type { EmployeeRecommendationState,EmployeeEvidenceState,EmployeeEmptyReason,MatchInsights } from '@job-talentio/shared';

import { Link } from '@/lib/navigation';
import { useApiResource } from '@/lib/useApiResource';
import { useSessionIdentity } from '@/lib/useSessionIdentity';
import { useMatchingStatus } from '@/lib/useMatchingStatus';
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
  job: RecommendedJob;matchInsights?:MatchInsights;
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
  const identity=useSessionIdentity();
  const active=!!identity&&getSession()?.user.role==='EMPLOYEE';
  const feed=useApiResource<{items:RecommendedItem[];state?:EmployeeRecommendationState;evidenceState?:EmployeeEvidenceState;preferenceWarnings?:string[];emptyReason?:EmployeeEmptyReason}>(active?'/jobs/recommended?page=1&limit=6':null);
  const me=useApiResource<ProfileSignal>(active&&process.env.NEXT_PUBLIC_EMPLOYEE_INTENT_V3!=='true'?'/profiles/me':null);
  const items=feed.data?.items.slice(0,HOME_FOR_YOU_LIMIT)||[];
  const recommendationState=feed.data?.state||(feed.error?'UNAVAILABLE':undefined);
  const profile=me.data||null;
  const ready=!feed.loading;
  useMatchingStatus(recommendationState==='CV_PROCESSING'||feed.data?.evidenceState==='PROCESSING',()=>{void feed.reload().catch(()=>{});void me.reload().catch(()=>{});});
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
      {ready&&recommendationState==='READY'&&<EmployeeRecommendationNotice state="READY" evidenceState={feed.data?.evidenceState} preferenceWarnings={feed.data?.preferenceWarnings}/>}
      {!ready ? (
        <div className="muted" style={{ minHeight: '2.5rem' }} />
      ) : recommendationState&&recommendationState!=='READY' ? (<EmployeeRecommendationNotice state={recommendationState} evidenceState={feed.data?.evidenceState} emptyReason={feed.data?.emptyReason} preferenceWarnings={feed.data?.preferenceWarnings}/>) : items.length === 0 ? (
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
                  <EmployeeMatchReasons insights={item.matchInsights}/>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </ExploreSection>
  );
}
