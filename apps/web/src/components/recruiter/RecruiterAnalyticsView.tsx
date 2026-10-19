'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ResourceError, WorkspaceLoading, Pagination } from '@/components/employee/WorkspacePrimitives';
import { localizedJobLocation } from '@/lib/location';
import { JobContextSelect } from './RecruiterPrimitives';
import type { JobStats } from './RecruiterAnalytics';
import s from './RecruiterWorkspace.module.css';
import c from './RecruiterReports.module.css';

const SOURCES: Record<string, string> = { direct:'sourceDirect', 'telegram:channel':'sourceTelegramChannel', 'telegram:bot':'sourceTelegramBot', telegram:'sourceTelegram', pwa:'sourcePwa', 'share:telegram':'sourceShareTelegram', 'share:copy':'sourceShareLink', 'share:sheet':'sourceShareSheet' };
function Row({ label, value, total }: { label:string; value:number; total:number }) {
  const percent = total ? Math.round(value / total * 1000) / 10 : 0;
  return <div className={c.funnel}><span>{label}</span><div><span style={{ width:Math.min(100, percent) + '%' }} /></div><strong>{value}<small>{percent}%</small></strong></div>;
}
function Trend({ points, label, locale }: { points:Array<{day:string;count:number}>; label:string; locale:string }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const date = (day:string) => new Date(day).toLocaleDateString(locale, { month:'short', day:'numeric' });
  return <section className={c.panel}><h2>{label}</h2><div className={c.trend} aria-label={label}>{points.map((p) => <div key={p.day} tabIndex={0} role="img" aria-label={date(p.day) + ': ' + p.count} className={c.bar} style={{ height:Math.max(2,p.count / max * 100) + '%', opacity:p.count ? 1 : .2 }}><span>{date(p.day)} | {p.count}</span></div>)}</div>{!!points.length && <div className={c.axis}><span>{date(points[0].day)}</span><span>{date(points[points.length-1].day)}</span></div>}</section>;
}
export function RecruiterAnalyticsView({ companyId, jobs, selectedJob, onSelectJob }: { companyId:string; jobs:any[]; selectedJob:string; onSelectJob:(id:string)=>void }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<'company'|'job'>('company');
  const [stats, setStats] = useState<JobStats|null>(null);
  const [error,setError] = useState('');
  const [retry,setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const [comparison, setComparison] = useState<Record<string, JobStats | null>>({});
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const safePage = Math.min(page, Math.max(1, Math.ceil(jobs.length / 10)));
  const visibleJobs = jobs.slice((safePage - 1) * 10, safePage * 10);
  const jobKey = visibleJobs.map((job) => job.id).join(',');
  useEffect(() => { setPage(1); setComparison({}); }, [companyId]);
  useEffect(() => {
    if (view !== 'company' || !jobKey) return;
    let active = true; setComparisonLoading(true);
    const ids = jobKey.split(',');
    void (async () => {
      for (let index = 0; index < ids.length; index += 4) {
        const chunk = ids.slice(index, index + 4);
        const results = await Promise.allSettled(chunk.map((id) => api<JobStats>('/jobs/' + id + '/stats')));
        if (!active) return;
        setComparison((current) => ({ ...current, ...Object.fromEntries(chunk.map((id, i) => [id, results[i].status === 'fulfilled' ? results[i].value : null])) }));
      }
      if (active) setComparisonLoading(false);
    })();
    return () => { active = false; };
  }, [companyId, jobKey, view, locale, retry]);
  useEffect(() => {
    let alive=true; setStats(null); setError('');
    if (view==='job' && !selectedJob) return;
    api<JobStats>(view==='company' ? '/jobs/company/'+companyId+'/stats' : '/jobs/'+selectedJob+'/stats').then((data) => { if(alive)setStats(data); }).catch((e) => {if(alive)setError(e instanceof Error?e.message:t('ew.loadFailed'));});
    return()=>{alive=false;};
  },[companyId,selectedJob,view,locale,retry]);
  function response(data:JobStats) {
    const h=data.responseTime.medianHours;
    return h===null ? '-' : h<1 ? t('rec.analytics.underOneHour') : t(h<48?'rec.analytics.hours':'rec.analytics.days').replace('{n}',String(Math.round(h<48?h:h/24)));
  }
  return <>
    <nav className={s.tabs} aria-label={t('rec.analytics.companyOverview')}><button aria-current={view==='company'?'page':undefined} onClick={()=>setView('company')}>{t('rw.companyOverview')}</button><button aria-current={view==='job'?'page':undefined} onClick={()=>setView('job')}>{t('rw.jobPerformance')}</button></nav>
    {view==='job' && <div className={s.toolbar}><JobContextSelect jobs={jobs} value={selectedJob} onChange={onSelectJob} /></div>}
    {error && <ResourceError message={error} onRetry={()=>setRetry((v)=>v+1)} />}
    <div className={s.scroll}>{!stats ? (view==='job' && !selectedJob ? <p className={s.emptyNote}>{t('rec.analytics.pickJob')}</p> : !error && <WorkspaceLoading />) : <>
      <p className={s.emptyNote}>{t('rw.allTime')}</p><div className={c.metrics}>{[[stats.funnel.views,'views'],[stats.funnel.applications,'applications'],[stats.funnel.interview,'interviews'],[stats.funnel.hired,'hired'],[response(stats),'firstResponse'],[stats.responseTime.waitingOverSla,'waitingOverSla']].map(([value,key])=><div key={String(key)} className={c.metric+(key==='waitingOverSla'&&Number(value)>0?' '+c.warn:'')}><span>{t('rec.analytics.'+key)}</span><strong>{value}</strong></div>)}</div>
      <div className={c.charts}><Trend locale={locale} points={stats.trend.views} label={t('rec.analytics.viewsTrend').replace('{n}',String(stats.trend.days))} /><Trend locale={locale} points={stats.trend.applications} label={t('rec.analytics.applicationsTrend').replace('{n}',String(stats.trend.days))} /></div>
      <div className={c.charts+' '+c.section}><section className={c.panel}><h2>{t('rw.hiringFunnel')}</h2><p className={s.emptyNote}>{t('rec.analytics.funnelHint')}</p>{[['views',stats.funnel.views],['applications',stats.funnel.applications],['inReview',stats.funnel.inReview],['interviews',stats.funnel.interview],['offers',stats.funnel.offer],['hired',stats.funnel.hired]].map(([key,count])=><Row key={String(key)} label={t('rec.analytics.'+key)} value={Number(count)} total={key==='views'||key==='applications'?stats.funnel.views:stats.funnel.applications} />)}<p className={s.emptyNote}>{t('rec.analytics.rejected')}: {stats.funnel.rejected}</p></section><section className={c.panel}><h2>{t('rec.analytics.sources')}</h2>{!stats.sources.length?<p className={s.emptyNote}>{t('rec.analytics.noApplications')}</p>:stats.sources.map((source)=><Row key={source.source} label={SOURCES[source.source]?t('rec.analytics.'+SOURCES[source.source]):source.source} value={source.count} total={stats.funnel.applications} />)}</section></div>
      {view === 'company' && jobs.length > 0 && <section className={c.section}><h2>{t('rw.performance')}</h2><div style={{overflowX:'auto'}}><table className={s.table} aria-busy={comparisonLoading}><thead><tr><th>{t('jobTitleFilter')}</th>{['views','applications','interviews','hired','firstResponse'].map((key) => <th key={key}>{t('rec.analytics.'+key)}</th>)}</tr></thead><tbody>{visibleJobs.map((job) => { const data = comparison[job.id]; return <tr key={job.id}><td><button className={s.title} onClick={() => { onSelectJob(job.id); setView('job'); }}>{job.title}</button><span className={s.sub}>{localizedJobLocation(job,t)}</span></td><td>{data?.funnel.views ?? job._count?.views ?? '-'}</td><td>{data?.funnel.applications ?? job._count?.applications ?? '-'}</td><td>{data?.funnel.interview ?? (data === undefined ? '...' : '-')}</td><td>{data?.funnel.hired ?? (data === undefined ? '...' : '-')}</td><td>{data ? response(data) : data === undefined ? '...' : <button className={s.textButton} onClick={() => setRetry((v)=>v+1)}>{t('workspace.retry')}</button>}</td></tr>; })}</tbody></table></div><Pagination page={safePage} total={jobs.length} onChange={setPage} /></section>}
    </>}</div>
  </>;
}
