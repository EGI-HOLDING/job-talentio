'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { jobDetailHref } from '@/lib/accountNavigation';
import { localizedJobLocation } from '@/lib/location';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { formatJobSalary } from '@/components/jobs/formatJobSalary';
import type { EmployeeJob } from './ApplicationsWorkspace';
import { WorkspaceIcon } from './WorkspaceIcon';
import { CompanyMark, SearchField, Pagination, ResourceError, WorkspaceEmpty, WorkspaceLoading, FindJobsAction, useEmployeeResource, dateLabel } from './WorkspacePrimitives';
import s from './Workspace.module.css';

type SavedJob = { id: string; createdAt: string; jobPost: EmployeeJob };
const SIZE = 10;

export function SavedJobsWorkspace() {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const resource = useEmployeeResource<SavedJob>('/profiles/me/saved-jobs');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => resource.items.filter((item) => (filter !== 'closed' || item.jobPost.status !== 'PUBLISHED') && [item.jobPost.title, item.jobPost.company?.name, item.jobPost.city?.name].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => (Date.parse(b.createdAt) - Date.parse(a.createdAt)) * (sort === 'oldest' ? -1 : 1)), [resource.items, filter, search, sort]);
  const safePage = Math.min(page, Math.max(1, Math.ceil(visible.length / SIZE)));
  useEffect(() => setPage(1), [search, filter, sort]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [page, filter, search, sort]);

  async function unsave(item: SavedJob) {
    setBusy(item.id);
    try {
      await api('/profiles/me/saved-jobs/' + item.jobPost.id, { method: 'DELETE' });
      resource.setItems((items) => items.filter((row) => row.id !== item.id));
      resource.setError('');
    } catch (error) { resource.setError(error instanceof Error ? error.message : t('ew.loadFailed')); }
    finally { setBusy(null); }
  }

  return <section className={s.root} aria-label={t('savedJobs')}>
    <div className={s.toolbar}><nav className={s.tabs} aria-label={t('savedJobs')}><button type="button" className={s.tab} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{t('ew.allSaved')}<span className={s.count}>{resource.items.length}</span></button><button type="button" className={s.tab} aria-pressed={filter === 'closed'} onClick={() => setFilter('closed')}>{t('ew.unavailable')}<span className={s.count}>{resource.items.filter((item) => item.jobPost.status !== 'PUBLISHED').length}</span></button></nav><div className={s.tools}><SearchField value={search} onChange={setSearch} placeholder={t('ew.searchSaved')} /><select className={s.select} aria-label={t('ew.sort')} value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">{t('ew.recentSaved')}</option><option value="oldest">{t('ew.oldest')}</option></select></div></div>
    {resource.error && <ResourceError message={resource.error} onRetry={() => { void resource.reload().catch((error: Error) => resource.setError(error.message)); }} />}
    {resource.loading ? <WorkspaceLoading /> : <div className={s.scroll} ref={scrollRef}>{!visible.length ? <WorkspaceEmpty icon="bookmark" title={t(resource.error && !resource.items.length ? 'ew.loadFailed' : resource.items.length ? 'ew.noResults' : 'ew.savedEmpty')} hint={resource.error && !resource.items.length ? undefined : t(resource.items.length ? 'ew.adjustSearch' : 'ew.savedHint')}>{!resource.error && !resource.items.length && <FindJobsAction />}</WorkspaceEmpty> : <table className={s.table + ' ' + s.savedTable}><colgroup><col style={{ width: '32%' }} /><col style={{ width: '20%' }} /><col style={{ width: '22%' }} /><col style={{ width: '12%' }} /><col style={{ width: '14%' }} /></colgroup><thead><tr><th scope="col">{t('ew.roleCompany')}</th><th scope="col">{t('ew.locationWork')}</th><th scope="col">{t('workspace.salary')}</th><th scope="col">{t('ew.savedOn')}</th><th scope="col"><span className="sr-only">{t('emp.details')}</span></th></tr></thead><tbody>{visible.slice((safePage - 1) * SIZE, safePage * SIZE).map((item) => {
      const job = { ...item.jobPost, title: item.jobPost.title || t('ew.unavailable') };
      const available = job.status === 'PUBLISHED';
      return <tr data-job-impression={available?job.id:undefined} key={item.id} className={available ? undefined : s.closed}><td><div className={s.companyCell}><CompanyMark name={job.company?.name || job.title} logo={job.company?.logoUrl} /><div className={s.companyText}>{available ? <Link href={jobDetailHref(job.id, '/dashboard/employee?tab=saved')}>{job.title}</Link> : <strong>{job.title}</strong>}<span className={s.sub}>{job.company?.name}</span></div></div></td><td><span>{localizedJobLocation(job, t)}</span>{job.employmentType && <span className={s.sub}>{enumLabel('employmentType', job.employmentType)}</span>}</td><td>{available ? formatJobSalary(job, locale, t) : '\u2014'}</td><td className={s.date} data-mobile="hide">{dateLabel(item.createdAt, locale)}</td><td><div className={s.actions}>{available ? <Link className={s.secondary} href={jobDetailHref(job.id, '/dashboard/employee?tab=saved')} aria-label={t('ew.viewJob') + ': ' + job.title} title={t('ew.viewJob')}><span className={s.jobActionText}>{t('ew.viewJob')}</span><span className={s.jobActionIcon}><WorkspaceIcon kind="external" /></span></Link> : <span className={s.status}>{t('ew.closed')}</span>}<button type="button" className={s.iconButton + ' ' + s.bookmarked} disabled={busy === item.id} aria-label={t('ew.removeSaved') + ': ' + job.title} title={t('ew.removeSaved')} onClick={() => void unsave(item)}><WorkspaceIcon kind="bookmark" /></button></div></td></tr>;
    })}</tbody></table>}</div>}
    {!resource.loading && <Pagination page={safePage} total={visible.length} size={SIZE} onChange={setPage} />}
  </section>;
}
