'use client';

import { useEffect, useState, useRef } from 'react';
import { useLiveRefresh } from '@/lib/useLiveRefresh';
import { api, apiBlob } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  ResourceError,
  WorkspaceLoading,
  Pagination,
} from '@/components/employee/WorkspacePrimitives';
import { localizedJobLocation } from '@/lib/location';
import { JobContextSelect } from './RecruiterPrimitives';
import type { JobStats } from './RecruiterAnalytics';
import s from './RecruiterWorkspace.module.css';
import c from './RecruiterReports.module.css';

const SOURCES: Record<string, string> = {
  direct: 'sourceDirect',
  'telegram:channel': 'sourceTelegramChannel',
  'telegram:bot': 'sourceTelegramBot',
  telegram: 'sourceTelegram',
  pwa: 'sourcePwa',
  'share:telegram': 'sourceShareTelegram',
  'share:copy': 'sourceShareLink',
  'share:sheet': 'sourceShareSheet',
};
function Row({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total ? Math.round((value / total) * 1000) / 10 : 0;
  return (
    <div className={c.funnel}>
      <span>{label}</span>
      <div>
        <span style={{ width: Math.min(100, percent) + '%' }} />
      </div>
      <strong>
        {value}
        <small>{percent}%</small>
      </strong>
    </div>
  );
}
function Trend({
  points,
  label,
  locale,
}: {
  points: Array<{ day: string; count: number }>;
  label: string;
  locale: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const date = (day: string) =>
    new Date(day).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <section className={c.panel}>
      <h2>{label}</h2>
      <div className={c.trend} aria-label={label}>
        {points.map((p) => (
          <div
            key={p.day}
            tabIndex={0}
            role="img"
            aria-label={date(p.day) + ': ' + p.count}
            className={c.bar}
            style={{ height: Math.max(2, (p.count / max) * 100) + '%', opacity: p.count ? 1 : 0.2 }}
          >
            <span>
              {date(p.day)} | {p.count}
            </span>
          </div>
        ))}
      </div>
      {!!points.length && (
        <div className={c.axis}>
          <span>{date(points[0].day)}</span>
          <span>{date(points[points.length - 1].day)}</span>
        </div>
      )}
    </section>
  );
}
export function RecruiterAnalyticsView({
  companyId,
  jobs,
  selectedJob,
  onSelectJob,
}: {
  companyId: string;
  jobs: any[];
  selectedJob: string;
  onSelectJob: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState('company'),
    [stats, setStats] = useState<any>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [busy, setBusy] = useState(false);
  const query = new URLSearchParams({
    companyId,
    ...(view === 'job' && selectedJob ? { jobId: selectedJob } : {}),
    ...(from ? { from: from + 'T00:00:00.000Z' } : {}),
    ...(to ? { to: to + 'T23:59:59.999Z' } : {}),
  }).toString();
  const loaded=useRef('');
  useLiveRefresh('applications',async()=>{setRetry(value=>value+1);},true,query+':'+locale);
  useEffect(() => {
    let alive = true;
    setError('');
    const identity=query+':'+locale;
    if (loaded.current!==identity) setStats(null);
    if (view === 'job' && !selectedJob) return;
    api('/hr-reports?' + query)
      .then((value) => {
        if (alive) { loaded.current=identity; setStats(value); }
      })
      .catch((error) => {
        if (alive) setError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [query, view, selectedJob, retry, locale]);
  async function download() {
    setBusy(true);
    try {
      const blob = await apiBlob('/hr-reports/csv?' + query);
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'recruitment-report.csv';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('ew.loadFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <nav className={s.tabs}>
        <button
          aria-current={view === 'company' ? 'page' : undefined}
          onClick={() => setView('company')}
        >
          {t('rw.companyOverview')}
        </button>
        <button aria-current={view === 'job' ? 'page' : undefined} onClick={() => setView('job')}>
          {t('rw.jobPerformance')}
        </button>
      </nav>
      <div className={s.toolbar}>
        {view === 'job' && (
          <JobContextSelect jobs={jobs} value={selectedJob} onChange={onSelectJob} />
        )}
        <label>
          {t('hr.from')}
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          {t('hr.to')}
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        {stats?.capabilities.reports && (
          <button className={s.secondary} disabled={busy} onClick={() => void download()}>
            {t('hr.exportCsv')}
          </button>
        )}
      </div>
      {error && <ResourceError message={error} onRetry={() => setRetry((value) => value + 1)} />}
      <div className={s.scroll}>
        {!stats ? (
          !error && <WorkspaceLoading />
        ) : (
          <>
            <p className={s.emptyNote}>{t('hr.reportWindow')}</p>
            <section className={c.metrics}>
              {['IMPRESSION', 'DETAIL_VIEW', 'APPLY_CLICK'].map((kind) => (
                <div className={c.metric} key={kind}>
                  <span>{t('hr.event.' + kind)}</span>
                  <strong>{stats.events[kind] || 0}</strong>
                </div>
              ))}
              <div className={c.metric}>
                <span>{t('applications')}</span>
                <strong>{stats.totalApplications}</strong>
              </div>
            </section>
            <p className={s.emptyNote}>
              {t('hr.historicalViews')}: {stats.historicalViews}
            </p>
            <div className={c.charts}>
              <Trend points={stats.trend.views} label={t('hr.event.DETAIL_VIEW')} locale={locale} />
              <Trend points={stats.trend.applications} label={t('applications')} locale={locale} />
            </div>
            {stats.capabilities.conversions && (
              <div className={c.charts}>
                <section className={c.panel}>
                  <h2>{t('hr.conversion')}</h2>
                  <p>{t('hr.conversionBase').replace('{count}', String(stats.conversionSessions ?? 0))}</p>
                  {[
                    'IMPRESSION',
                    'DETAIL_VIEW',
                    'APPLY_CLICK',
                    'APPLY_START',
                    'APPLICATION_SUBMITTED',
                  ].map((kind) => (
                    <Row
                      key={kind}
                      label={t('hr.event.' + kind)}
                      value={stats.conversion?.[kind] || 0}
                      total={stats.conversionSessions ?? 0}
                    />
                  ))}
                </section>
                <section className={c.panel}>
                  <h2>{t('rec.analytics.sources')}</h2>
                  {stats.sources.map((source: any) => (
                    <Row
                      key={source.source}
                      label={
                        SOURCES[source.source]
                          ? t('rec.analytics.' + SOURCES[source.source])
                          : source.source
                      }
                      value={source.count}
                      total={stats.sources.reduce((sum: number, row: any) => sum + row.count, 0)}
                    />
                  ))}
                </section>
              </div>
            )}
            {stats.capabilities.reports && (
              <>
                <section className={c.panel}>
                  <h2>{t('rw.hiringFunnel')}</h2>
                  {[
                    ['inReview', 'inReview'],
                    ['interview', 'interviews'],
                    ['offer', 'offers'],
                    ['hired', 'hired'],
                  ].map(([key, label]) => (
                    <Row
                      key={key}
                      label={t('rec.analytics.' + label)}
                      value={stats.funnel[key]}
                      total={stats.comparisons.reduce(
                        (sum: number, row: any) => sum + row.applications,
                        0,
                      )}
                    />
                  ))}
                  <p>
                    {t('rec.analytics.firstResponse')}:{' '}
                    {stats.responseTime.medianHours === null
                      ? '-'
                      : stats.responseTime.medianHours.toFixed(1) + ' ' + t('hr.hours')}
                  </p>
                  <p>
                    {t('hr.hireTime')}:{' '}
                    {stats.responseTime.medianHireHours === null
                      ? '-'
                      : stats.responseTime.medianHireHours.toFixed(1) + ' ' + t('hr.hours')}
                  </p>
                  <p>
                    {t('rec.analytics.waitingOverSla')}: {stats.responseTime.waitingOverSla}
                  </p>
                </section>
                <section className={c.panel}>
                  <h2>{t('rw.performance')}</h2>
                  <div className={c.tableScroll} role="region" aria-label={t('rw.performance')} tabIndex={0}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>{t('jobTitleFilter')}</th>
                        <th>{t('applications')}</th>
                        <th>{t('rec.analytics.hired')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.comparisons.map((job: any) => (
                        <tr key={job.jobId}>
                          <td>
                            <button
                              className={s.textButton}
                              onClick={() => {
                                onSelectJob(job.jobId);
                                setView('job');
                              }}
                            >
                              {job.title}
                            </button>
                          </td>
                          <td>{job.applications}</td>
                          <td>{job.hired}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
