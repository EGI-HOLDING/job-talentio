'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { localizedJobLocation } from '@/lib/location';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { SearchField, WorkspaceEmpty, WorkspaceLoading, Pagination, dateLabel } from '@/components/employee/WorkspacePrimitives';
import { WorkspaceSelect } from '@/components/jobs/WorkspaceSelect';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { RecruiterJobEditor } from './RecruiterJobEditor';
import s from './RecruiterWorkspace.module.css';
import { RecruiterJobActions } from './RecruiterJobActions';

type Props = { companyId: string; company: any; jobs: any[]; loading: boolean; meta: any; createRequested: boolean; onCloseCreate: () => void; onReload: () => Promise<void>; onApplicants: (id: string) => void; onStatus: (id: string, status: string, message: string) => Promise<void>; onFlash: (message: string, tone?: 'success' | 'error') => void };
export function RecruiterJobs({ companyId, company, jobs, loading, meta, createRequested, onCloseCreate, onReload, onApplicants, onStatus, onFlash }: Props) {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | 'new' | null>(createRequested ? 'new' : null);
  const [busyId, setBusyId] = useState('');
  const [opening, setOpening] = useState(false);
  async function openEditor(job: any) {
    if (opening) return;
    setOpening(true);
    try {
      const details = await api<any>('/jobs/' + job.id);
      // The table contains source-language text; detail adds the complete requirements.
      setEditing({ ...details, ...job, jobSkills: details.jobSkills || job.jobSkills || [], benefits: details.benefits || [] });
    } catch (reason) { onFlash(reason instanceof Error ? reason.message : t('ew.loadFailed'), 'error'); }
    finally { setOpening(false); }
  }
  useEffect(() => { if (createRequested) setEditing('new'); }, [createRequested]);
  useEffect(() => { setPage(1); }, [query, status, sort]);
  const filtered = useMemo(() => jobs.filter((job) => (status === 'ALL' || job.status === status) && [job.title, job.city?.name].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => sort === 'applications' ? (b._count?.applications || 0) - (a._count?.applications || 0) : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [jobs, query, status, sort]);
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 10)));
  async function change(job: any, next: string) {
    if (busyId) return;
    if ((next === 'CLOSED' || next === 'PUBLISHED') && !await confirm({ title: next === 'CLOSED' ? t('rec.closeJob') : t('rw.publishConfirm'), message: next === 'CLOSED' ? job.title : t('rw.publishHint'), confirmLabel: next === 'CLOSED' ? t('rec.closeJob') : t('rec.publish'), ...(next === 'CLOSED' ? { tone: 'danger' as const } : {}) })) return;
    setBusyId(job.id);
    try { await onStatus(job.id, next, t(next === 'PUBLISHED' ? 'rec.jobPublished' : next === 'PAUSED' ? 'rec.jobPaused' : 'rec.jobClosed')); } finally { setBusyId(''); }
  }
  function closeEditor() { setEditing(null); onCloseCreate(); }
  if (editing) return <RecruiterJobEditor key={editing === 'new' ? 'new-' + companyId : editing.id} companyId={companyId} company={company} job={editing === 'new' ? null : editing} meta={meta} onClose={closeEditor} onSaved={async (message) => { await onReload(); onFlash(message); }} />;
  if (opening) return <WorkspaceLoading />;
  return <>
    <div className={s.toolbar}><SearchField value={query} onChange={setQuery} placeholder={t('rw.searchJobs')} /><WorkspaceSelect value={sort} options={[{ value: 'newest', label: t('rw.newest') }, { value: 'applications', label: t('applications') }]} label={t('sortBy')} onChange={setSort} /><button type="button" className={s.primary} onClick={() => setEditing('new')}><WorkspaceIcon kind="plus" />{t('postAJob')}</button></div>
    <nav className={s.tabs} aria-label={t('jobs')}>{[['ALL', 'rw.allJobs'], ['PUBLISHED', 'rw.published'], ['DRAFT', 'rw.drafts'], ['PAUSED', 'rw.paused'], ['CLOSED', 'rw.closed']].map(([key, label]) => <button key={key} type="button" aria-current={status === key ? 'page' : undefined} onClick={() => setStatus(key)}>{t(label)}<span className={s.count}>{key === 'ALL' ? jobs.length : jobs.filter((job) => job.status === key).length}</span></button>)}</nav>
    <div className={s.summary}><span><strong>{jobs.filter((job) => job.status === 'PUBLISHED').length}</strong>{t('rw.published')}</span><span><strong>{jobs.reduce((sum, job) => sum + (job._count?.applications || 0), 0)}</strong>{t('applications')}</span><span><strong>{jobs.reduce((sum, job) => sum + (job._count?.views || 0), 0)}</strong>{t('rec.viewsWord')}</span></div>
    {loading ? <WorkspaceLoading /> : !filtered.length ? <WorkspaceEmpty title={t(jobs.length ? 'rw.noResults' : 'rw.noJobs')} hint={jobs.length ? undefined : t('rw.noJobsHint')}>{jobs.length ? <button className={s.secondary} onClick={() => { setQuery(''); setStatus('ALL'); }}>{t('clearFilters')}</button> : <button className={s.primary} onClick={() => setEditing('new')}>{t('postAJob')}</button>}</WorkspaceEmpty> : <div className={s.tableWrap} data-jobs="true"><table className={s.table}><thead><tr><th>{t('jobTitleFilter')}</th><th>{t('status')}</th><th>{t('city')}</th><th>{t('applications')}</th><th>{t('rec.viewsWord')}</th><th>{t('rw.posted')}</th><th><span className="sr-only">{t('rw.actions')}</span></th></tr></thead><tbody>{filtered.slice((safePage - 1) * 10, safePage * 10).map((job) => <tr key={job.id}><td><button className={s.title} onClick={() => onApplicants(job.id)}>{job.title}</button><span className={s.sub}>{[enumLabel('employmentType', job.employmentType), enumLabel('experienceLevel', job.experienceLevel)].filter(Boolean).join(' | ')}</span></td><td data-label={t('status')}><span className={s.status} data-status={job.status}>{enumLabel('jobStatus', job.status)}</span></td><td data-label={t('city')}>{localizedJobLocation(job, t)}</td><td data-label={t('applications')}>{job._count?.applications ?? 0}</td><td data-label={t('rec.viewsWord')}>{job._count?.views ?? 0}</td><td data-label={t('rw.posted')} className={s.sub}>{dateLabel(job.createdAt, locale)}</td><td><div className={s.actions}><button className={s.textButton} onClick={() => onApplicants(job.id)}>{t('rw.applicants')}</button><RecruiterJobActions job={job} companyId={companyId} busy={busyId === job.id} onEdit={() => void openEditor(job)} onStatus={(next) => void change(job, next)} /></div></td></tr>)}</tbody></table></div>}
    <Pagination page={safePage} total={filtered.length} onChange={setPage} />
  </>;
}
