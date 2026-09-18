'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export type JobStats = {
  views: number;
  totalApplications: number;
  applicationsByStatus: Record<string, number>;
  funnel: {
    views: number;
    applications: number;
    inReview: number;
    interview: number;
    offer: number;
    hired: number;
    rejected: number;
  };
  sources: Array<{ source: string; count: number }>;
  responseTime: { medianHours: number | null; answered: number; waitingOverSla: number };
  trend: {
    days: number;
    views: Array<{ day: string; count: number }>;
    applications: Array<{ day: string; count: number }>;
  };
};

type Props = {
  companyId: string;
  jobs: Array<{ id: string; title: string }>;
  selectedJob: string;
  onSelectJob: (id: string) => void;
  jobLabel: (job: { id: string; title: string }) => string;
};

const SOURCE_KEYS: Record<string, string> = {
  direct: 'rec.analytics.sourceDirect',
  'telegram:channel': 'rec.analytics.sourceTelegramChannel',
  'telegram:bot': 'rec.analytics.sourceTelegramBot',
  telegram: 'rec.analytics.sourceTelegram',
  pwa: 'rec.analytics.sourcePwa',
  'share:telegram': 'rec.analytics.sourceShareTelegram',
  'share:copy': 'rec.analytics.sourceShareLink',
  'share:sheet': 'rec.analytics.sourceShareSheet',
};

function pct(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

function Bars({ points, label }: { points: Array<{ day: string; count: number }>; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <div className="stat-trend" role="img" aria-label={label}>
      {points.map((p) => (
        <span
          key={p.day}
          className="stat-trend-bar"
          style={{ height: `${Math.max(4, Math.round((p.count / max) * 100))}%` }}
          title={`${p.day}: ${p.count}`}
        />
      ))}
    </div>
  );
}

function FunnelRow({ label, value, base }: { label: string; value: number; base: number }) {
  const width = base ? Math.max(2, Math.round((value / base) * 100)) : 0;
  return (
    <div className="funnel-row">
      <span className="funnel-label">{label}</span>
      <span className="funnel-track">
        <span className="funnel-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="funnel-value">
        {value} <span className="muted">({pct(value, base)})</span>
      </span>
    </div>
  );
}

export function RecruiterAnalytics({ companyId, jobs, selectedJob, onSelectJob, jobLabel }: Props) {
  const { t } = useI18n();
  const [company, setCompany] = useState<JobStats | null>(null);
  const [job, setJob] = useState<JobStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    api<JobStats>(`/jobs/company/${companyId}/stats`)
      .then((s) => {
        if (!cancelled) setCompany(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('rec.analytics.loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, t]);

  useEffect(() => {
    if (!selectedJob) {
      setJob(null);
      return;
    }
    let cancelled = false;
    api<JobStats>(`/jobs/${selectedJob}/stats`)
      .then((s) => {
        if (!cancelled) setJob(s);
      })
      .catch(() => {
        if (!cancelled) setJob(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedJob]);

  function sourceLabel(source: string): string {
    const key = SOURCE_KEYS[source];
    return key ? t(key) : source;
  }

  function responseText(stats: JobStats): string {
    const median = stats.responseTime.medianHours;
    if (median === null) return t('rec.analytics.noResponsesYet');
    if (median < 1) return t('rec.analytics.underOneHour');
    if (median < 48) return t('rec.analytics.hours').replace('{n}', String(Math.round(median)));
    return t('rec.analytics.days').replace('{n}', String(Math.round(median / 24)));
  }

  const overview = company;
  const current = job;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {error && <div className="error">{error}</div>}

      {overview && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('rec.analytics.companyOverview')}</h3>
          <div className="stat-tiles">
            <div className="stat-tile">
              <strong>{overview.funnel.views}</strong>
              <span>{t('rec.analytics.views')}</span>
            </div>
            <div className="stat-tile">
              <strong>{overview.funnel.applications}</strong>
              <span>{t('rec.analytics.applications')}</span>
            </div>
            <div className="stat-tile">
              <strong>{overview.funnel.interview}</strong>
              <span>{t('rec.analytics.interviews')}</span>
            </div>
            <div className="stat-tile">
              <strong>{overview.funnel.hired}</strong>
              <span>{t('rec.analytics.hired')}</span>
            </div>
            <div className="stat-tile">
              <strong>{responseText(overview)}</strong>
              <span>{t('rec.analytics.firstResponse')}</span>
            </div>
            <div className={`stat-tile${overview.responseTime.waitingOverSla ? ' stat-tile--warn' : ''}`}>
              <strong>{overview.responseTime.waitingOverSla}</strong>
              <span>{t('rec.analytics.waitingOverSla')}</span>
            </div>
          </div>
          <div className="grid-2" style={{ marginTop: '1rem' }}>
            <div>
              <p className="muted" style={{ margin: '0 0 0.35rem', fontSize: '0.8rem' }}>
                {t('rec.analytics.viewsTrend').replace('{n}', String(overview.trend.days))}
              </p>
              <Bars points={overview.trend.views} label={t('rec.analytics.viewsTrend').replace('{n}', String(overview.trend.days))} />
            </div>
            <div>
              <p className="muted" style={{ margin: '0 0 0.35rem', fontSize: '0.8rem' }}>
                {t('rec.analytics.applicationsTrend').replace('{n}', String(overview.trend.days))}
              </p>
              <Bars
                points={overview.trend.applications}
                label={t('rec.analytics.applicationsTrend').replace('{n}', String(overview.trend.days))}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('rec.jobAnalytics')}</h3>
        <select
          value={selectedJob}
          onChange={(e) => onSelectJob(e.target.value)}
          className="job-select"
          title={t('rec.selectJobPost')}
          aria-label={t('rec.selectJobPost')}
        >
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {jobLabel(j)}
            </option>
          ))}
        </select>
        {current ? (
          <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
            <div>
              <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.8rem' }}>
                {t('rec.analytics.funnelHint')}
              </p>
              <FunnelRow label={t('rec.analytics.views')} value={current.funnel.views} base={current.funnel.views} />
              <FunnelRow
                label={t('rec.analytics.applications')}
                value={current.funnel.applications}
                base={current.funnel.views}
              />
              <FunnelRow
                label={t('rec.analytics.inReview')}
                value={current.funnel.inReview}
                base={current.funnel.applications}
              />
              <FunnelRow
                label={t('rec.analytics.interviews')}
                value={current.funnel.interview}
                base={current.funnel.applications}
              />
              <FunnelRow label={t('rec.analytics.offers')} value={current.funnel.offer} base={current.funnel.applications} />
              <FunnelRow label={t('rec.analytics.hired')} value={current.funnel.hired} base={current.funnel.applications} />
              <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
                {t('rec.analytics.rejected')}: {current.funnel.rejected}
              </p>
            </div>
            <div>
              <h4 style={{ margin: '0 0 0.5rem' }}>{t('rec.analytics.sources')}</h4>
              {current.sources.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>{t('rec.analytics.noApplications')}</p>
              ) : (
                current.sources.map((s) => (
                  <FunnelRow
                    key={s.source}
                    label={sourceLabel(s.source)}
                    value={s.count}
                    base={current.funnel.applications}
                  />
                ))
              )}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              {t('rec.analytics.firstResponse')}: <strong>{responseText(current)}</strong>
              {current.responseTime.waitingOverSla > 0
                ? ` | ${t('rec.analytics.waitingOverSla')}: ${current.responseTime.waitingOverSla}`
                : ''}
            </p>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: '1rem' }}>{t('rec.analytics.pickJob')}</p>
        )}
      </div>
    </div>
  );
}
