'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { DEFAULT_PIPELINE } from '@job-talentio/shared';
import { ApplicantFilters } from './ApplicantFilters';
import { RecruiterAvatar } from './RecruiterPrimitives';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { ResourceError, WorkspaceEmpty, WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import s from './JobWorkspace.module.css';
import { Applicant, ApplicationCvAction, KanbanAction } from './ApplicationActions';
import { ApplicationDetail } from './ApplicationDetail';

const PAGE_SIZE = 10;

/** Query the complete authorized pool before server-side ranking/pagination. */
export function JobApplicants({ jobId, companyId, meta, revision=0, applicationId, onChanged }: { jobId: string; companyId: string; meta: any; revision?:number; applicationId?:string; onChanged:()=>void }) {
  const { t, locale } = useI18n();
  const enumLabel=useEnumLabel();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState('match');
  const [status,setStatus]=useState(''),[detail,setDetail]=useState<string|null>(applicationId||null);
  useEffect(()=>{setDetail(applicationId||null);},[applicationId]);
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ items: Applicant[]; total: number; page: number }>({ items: [], total: 0, page: 1 });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const filterKey = JSON.stringify(filters);
  const activeFilters = Object.values(filters).filter(value => value && value !== 'false').length;

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({
      ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
      q: query.trim(), sort, ...(status?{status}:{}),
      page: String(page), limit: String(PAGE_SIZE),
    });
    const timer = setTimeout(() => {
      api<typeof result>('/applications/jobs/'+encodeURIComponent(jobId)+'/search?' + params)
        .then(data => { if (alive) { setResult(data); if (data.page !== page) setPage(data.page); } })
        .catch(reason => { if (alive) setError(reason.message); })
        .finally(() => { if (alive) setLoading(false); });
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [jobId, companyId, query, filterKey, sort, status, page, retry, locale, revision]);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const firstPage = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pageNumbers = Array.from({ length: Math.min(5, pageCount) }, (_, index) => firstPage + index);
  const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });

  return <section className={s.card} aria-label={t('ranking.applicants')}>
    <div className={s.rankingHeader}>
      <div className={s.rankingIntro}><h2>{loading ? t('ranking.applicants') : t('applicants.count').replace('{n}', number(result.total))}</h2></div>
      <div className={s.controls}>
        <label className={s.search}><WorkspaceIcon kind="search"/><input type="search" aria-label={t('ranking.search')} placeholder={t('ranking.search')} value={query} onChange={event => { setPage(1); setQuery(event.target.value); }}/></label>
        <button type="button" className={s.secondary} aria-expanded={filtersOpen} aria-controls="job-candidate-filters" onClick={() => setFiltersOpen(open => !open)}><WorkspaceIcon kind="filter"/>{t('ranking.filter')}{activeFilters > 0 && <span className={s.count}>{activeFilters}</span>}</button>
        <select className={s.statusFilter} aria-label={t('status')} value={status} onChange={event=>{setPage(1);setStatus(event.target.value);}}><option value="">{t('rw.allApplicants')}</option>{DEFAULT_PIPELINE.map(value=><option key={value} value={value}>{enumLabel('applicationStatus',value)}</option>)}</select>
        <label className={s.sort}><WorkspaceIcon kind="sort"/><span className="sr-only">{t('sortBy')}</span><select aria-label={t('sortBy')} value={sort} onChange={event => { setPage(1); setSort(event.target.value); }}><option value="match">{t('ranking.sortMatch')}</option><option value="newest">{t('applicants.sortNewest')}</option></select></label>
      </div>
    </div>
    <p className={s.rankingNote}>{t(sort === 'match' ? 'applicants.orderExplanation' : 'applicants.newestExplanation')}</p>
    <div id="job-candidate-filters" className={s.filterPanel} hidden={!filtersOpen}><ApplicantFilters embedded meta={meta} onApply={value => { setPage(1); setFilters(value); setFiltersOpen(false); }}/></div>
    {error ? <ResourceError message={error} onRetry={() => setRetry(n => n + 1)}/> : loading ? <WorkspaceLoading/> : !result.items.length ? <WorkspaceEmpty title={t('applicants.empty')} hint={t('applicants.emptyHint')}/> : <div className={s.tableScroll}>
      <table className={s.table+' '+s.applicantsTable}><colgroup><col className={s.rankColumn}/><col className={s.candidateColumn}/><col className={s.roleColumn}/><col className={s.locationColumn}/><col className={s.statusColumn}/><col className={s.actionColumn}/></colgroup>
        <thead><tr><th scope="col">{t(sort === 'match' ? 'ranking.rank' : 'ranking.rowNumber')}</th><th scope="col">{t('applicants.person')}</th><th scope="col">{t('ranking.position')}</th><th scope="col">{t('ranking.location')}</th><th scope="col">{t('status')}</th><th scope="col">{t('rw.actions')}</th></tr></thead>
        <tbody>{result.items.map((item, index) => {
          const profile=item.profile;
          const location = profile.city?.name || profile.residenceCountry?.name;
          return <tr key={item.id}>
            <td className={s.rank}>{number((page - 1) * PAGE_SIZE + index + 1)}</td>
            <td><div className={s.identity}><RecruiterAvatar className={s.avatar} name={profile.user.fullName} src={profile.user.avatarUrl}/><button className={s.name} onClick={()=>setDetail(item.id)}>{profile.user.fullName}</button></div></td>
            <td className={s.position}>{profile.headline || t('ranking.noHeadline')}</td>
            <td><span className={s.location}>{location && <WorkspaceIcon kind="pin"/>}{location || t('ranking.notProvided')}</span></td>
            <td><span className={s.applicationStatus} data-status={item.status}>{enumLabel('applicationStatus',item.status)}</span></td>
            <td><div className={s.rowActions}><KanbanAction application={item} jobId={jobId} companyId={companyId} onChanged={value=>{setResult(current=>({...current,items:current.items.map(row=>row.id===item.id?{...row,...value}:row)}));onChanged();}}/><ApplicationCvAction application={item}/><button className={s.profileButton} onClick={()=>setDetail(item.id)}>{t('applicants.details')}</button></div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {!error && !loading && result.total > 0 && <footer className={s.paginationFooter}>
      <span aria-live="polite">{t('ew.showing').replace('{from}', number((page - 1) * PAGE_SIZE + 1)).replace('{to}', number(Math.min(page * PAGE_SIZE, result.total))).replace('{total}', number(result.total))}</span>
      <nav aria-label={t('ew.page').replace('{n}', String(page))}>
        <button type="button" disabled={page <= 1} aria-label={t('ew.previousPage')} onClick={() => setPage(page - 1)}><WorkspaceIcon kind="left"/></button>
        {firstPage > 1 && <><button type="button" onClick={() => setPage(1)}>1</button>{firstPage > 2 && <span>...</span>}</>}
        {pageNumbers.map(value => <button type="button" key={value} aria-current={value === page ? 'page' : undefined} aria-label={t('ew.page').replace('{n}', String(value))} onClick={() => setPage(value)}>{value}</button>)}
        {pageNumbers.at(-1)! < pageCount && <>{pageNumbers.at(-1)! < pageCount - 1 && <span>...</span>}<button type="button" onClick={() => setPage(pageCount)}>{pageCount}</button></>}
        <button type="button" disabled={page >= pageCount} aria-label={t('ew.nextPage')} onClick={() => setPage(page + 1)}><WorkspaceIcon kind="right"/></button>
      </nav>
    </footer>}
    {detail&&<ApplicationDetail key={jobId+':'+detail} applicationId={detail} jobId={jobId} companyId={companyId} onClose={()=>setDetail(null)} onChanged={()=>{setRetry(n=>n+1);onChanged();}}/>}
  </section>;
}
