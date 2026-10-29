'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useLiveRefresh } from '@/lib/useLiveRefresh';
import { useRouter } from '@/lib/navigation';
import { employerJobHref } from '@/lib/accountNavigation';
import { useI18n } from '@/lib/i18n';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { SearchField, WorkspaceEmpty, WorkspaceLoading, Pagination } from '@/components/employee/WorkspacePrimitives';
import { WorkspaceSelect } from '@/components/jobs/WorkspaceSelect';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { RecruiterJobEditor } from './RecruiterJobEditor';
import s from './RecruiterWorkspace.module.css';
import { RecruiterJobRow } from './RecruiterJobRow';
import table from './RecruiterJobTable.module.css';
import bar from './RecruiterJobsToolbar.module.css';

type Props = { companyId: string; company: any; jobs: any[]; loading: boolean; meta: any; createRequested: boolean; onCloseCreate: () => void; onReload: (quiet?:boolean) => Promise<void>; onApplicants: (id: string) => void; onStatus: (id: string, status: string, message: string) => Promise<void>; onFlash: (message: string, tone?: 'success' | 'error') => void };
export function RecruiterJobs({ companyId, company, jobs, loading, meta, createRequested, onCloseCreate, onReload, onApplicants, onStatus, onFlash }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | 'new' | null>(createRequested ? 'new' : null);
  const [busyId, setBusyId] = useState('');
  useLiveRefresh('applications', async()=>{await onReload(true);}, !loading && !busyId && !editing, companyId);
  const actionLock = useRef(false);
  const alive = useRef(true);
  const contextVersion = useRef(0);
  const currentCompany = useRef(companyId);
  if (currentCompany.current !== companyId) { currentCompany.current = companyId; ++contextVersion.current; }
  const refreshingRows = useRef<Promise<void> | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setEditing(createRequested ? 'new' : null); setOpening(false); setBusyId(''); actionLock.current = false; refreshingRows.current = null; }, [companyId]);
  function refreshRows() {
    if (!refreshingRows.current) {
      const request = onReload(); refreshingRows.current = request;
      void request.catch(() => { if (alive.current && currentCompany.current === companyId) onFlash(t('ew.loadFailed'), 'error'); }).finally(() => { if (refreshingRows.current === request) refreshingRows.current = null; });
    }
  }
  async function openEditor(job: any, initialStep = 0) {
    if (opening) return;
    const requested = contextVersion.current;
    setOpening(true);
    try {
      const details = await api<any>('/jobs/' + job.id);
      if (!alive.current || contextVersion.current !== requested) return;
      // The table contains source-language text; detail adds the complete requirements.
      setEditing({ ...details, ...job, jobSkills: details.jobSkills || job.jobSkills || [], benefits: details.benefits || [], _initialStep: initialStep });
    } catch (reason) { if (alive.current && contextVersion.current === requested) onFlash(reason instanceof Error ? reason.message : t('ew.loadFailed'), 'error'); }
    finally { if (alive.current && contextVersion.current === requested) setOpening(false); }
  }
  useEffect(() => { if (createRequested) setEditing('new'); }, [createRequested]);
  useEffect(() => { setPage(1); }, [query, status, sort]);
  const filtered = useMemo(() => jobs.filter((job) => (status === 'ALL' || job.status === status) && [job.title, job.city?.name, job.country?.name].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => sort === 'applications' ? (b._count?.applications || 0) - (a._count?.applications || 0) : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [jobs, query, status, sort]);
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 10)));
  async function change(job: any, next: string) {
    if (actionLock.current) return;
    const requested = contextVersion.current;
    actionLock.current = true;
    try {
      const actionLabel = next === 'CLOSED' ? t('rec.closeJob') : job.status === 'CLOSED' ? t('rec.reopen') : t('rec.resumeJob');
      if ((next === 'CLOSED' || next === 'PUBLISHED') && !await confirm({ title: actionLabel, message: job.title, confirmLabel: actionLabel, ...(next === 'CLOSED' ? { tone: 'danger' as const } : {}) })) return;
      if (!alive.current || contextVersion.current !== requested) return;
      setBusyId(job.id);
      await onStatus(job.id, next, t(next === 'PUBLISHED' ? 'rec.jobPublished' : next === 'PAUSED' ? 'rec.jobPaused' : 'rec.jobClosed'));
    } finally { if (alive.current && contextVersion.current === requested) { actionLock.current = false; setBusyId(''); } }
  }
  async function duplicate(job: any) {
    if (actionLock.current) return;
    const requested = contextVersion.current;
    actionLock.current = true; setBusyId(job.id);
    try {
      const created = await api<any>('/jobs/' + job.id + '/duplicate', { method: 'POST', body: '{}' });
      if (!alive.current || contextVersion.current !== requested) return;
      setEditing(created);
      try { await onReload(); } catch { if (alive.current && contextVersion.current === requested) onFlash(t('jr.draftCreatedRefreshFailed'), 'error'); }
    } catch (error) { if (alive.current && contextVersion.current === requested) onFlash(error instanceof Error ? error.message : t('ew.loadFailed'), 'error'); }
    finally { if (alive.current && contextVersion.current === requested) { actionLock.current = false; setBusyId(''); } }
  }
  function closeEditor() { setEditing(null); onCloseCreate(); }
  if (editing) return <RecruiterJobEditor key={editing === 'new' ? 'new-' + companyId : editing.id} companyId={companyId} company={company} job={editing === 'new' ? null : editing} initialStep={editing === 'new' ? 0 : editing._initialStep || 0} meta={meta} onClose={closeEditor} onPublished={(id)=>router.push(employerJobHref(id,'applicants',companyId))} onSaved={async (message) => { await onReload(); onFlash(message); }} />;
  if (opening) return <WorkspaceLoading />;
  return <>
    <div className={bar.root} data-jobs-toolbar>
      <dl className={bar.metrics} aria-label={t('hr.freeStats')}>
        {[[jobs.filter(job => job.status === 'PUBLISHED').length, t('rw.published')], [jobs.reduce((sum, job) => sum + (job._count?.applications || 0), 0), t('applications')], [jobs.reduce((sum, job) => sum + (job._count?.views || 0), 0), t('rec.viewsWord')]].map(([value, label]) => <div key={label}><dt>{label}</dt><dd>{new Intl.NumberFormat(locale).format(Number(value))}</dd></div>)}
      </dl>
      <div className={bar.controls}><SearchField value={query} onChange={setQuery} placeholder={t('rw.searchJobsCompact')} /><WorkspaceSelect className={bar.sort} value={sort} options={[{ value: 'newest', label: t('rw.newest') }, { value: 'applications', label: t('applications') }]} label={t('sortBy')} onChange={setSort} /><button type="button" className={s.primary + ' ' + bar.create} onClick={() => setEditing('new')}><WorkspaceIcon kind="plus" />{t('postAJob')}</button></div>
    </div>
    <nav className={s.tabs} aria-label={t('jobs')}>{[['ALL', 'rw.allJobs'], ['PUBLISHED', 'rw.published'], ['DRAFT', 'rw.drafts'], ['PAUSED', 'rw.paused'], ['CLOSED', 'rw.closed'], ['EXPIRED', 'hr.expired']].map(([key, label]) => <button key={key} type="button" aria-current={status === key ? 'page' : undefined} onClick={() => setStatus(key)}>{t(label)}<span className={s.count}>{key === 'ALL' ? jobs.length : jobs.filter((job) => job.status === key).length}</span></button>)}</nav>

    {loading ? <WorkspaceLoading /> : !filtered.length ? <WorkspaceEmpty title={t(jobs.length ? 'rw.noResults' : 'rw.noJobs')} hint={jobs.length ? undefined : t('rw.noJobsHint')}>{jobs.length ? <button className={s.secondary} onClick={() => { setQuery(''); setStatus('ALL'); }}>{t('clearFilters')}</button> : <button className={s.primary} onClick={() => setEditing('new')}>{t('postAJob')}</button>}</WorkspaceEmpty> : <div className={table.wrap} data-jobs-table><table className={table.table}>
      <colgroup><col className={table.titleCol} /><col className={table.statusCol} /><col className={table.packageCol} /><col className={table.locationCol} /><col className={table.performanceCol} /><col className={table.periodCol} /><col className={table.boostCol} /><col className={table.actionsCol} /></colgroup>
      <thead><tr>{['jobTitleFilter', 'status', 'jr.package', 'city', 'jr.performance', 'jr.period', 'jr.boost', 'rw.actions'].map(key => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
      <tbody>{filtered.slice((safePage - 1) * 10, safePage * 10).map(job => <RecruiterJobRow key={companyId + ':' + job.id} job={job} companyId={companyId} companyOpen={!company?.anonymizedAt && !company?.isBanned} busy={Boolean(busyId)} onEdit={() => void openEditor(job)} onReviewPublish={() => void openEditor(job, 3)} onDuplicate={() => void duplicate(job)} onStatus={next => void change(job, next)} onApplicants={() => onApplicants(job.id)} onPeriodExpired={refreshRows} onFlash={onFlash} />)}</tbody>
    </table></div>}

    {!loading && filtered.length > 0 && <Pagination page={safePage} total={filtered.length} onChange={setPage} />}
  </>;
}
