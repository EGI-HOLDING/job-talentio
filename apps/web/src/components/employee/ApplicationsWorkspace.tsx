'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { jobDetailHref } from '@/lib/accountNavigation';
import { localizedJobLocation } from '@/lib/location';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { ProfileDialog } from '@/components/profile/ProfileDialog';
import { WorkspaceIcon } from './WorkspaceIcon';
import { CompanyMark, SearchField, Pagination, ResourceError, WorkspaceEmpty, WorkspaceLoading, FindJobsAction, useEmployeeResource, dateLabel } from './WorkspacePrimitives';
import s from './Workspace.module.css';

export type EmployeeJob = {
  id: string; title: string; status: string; isAnonymous?: boolean;
  company?: { name: string; slug?: string; logoUrl?: string | null; chatPeerUserId?: string | null } | null;
  city?: { name: string } | null; workMode?: string | null; employmentType?: string;
  salaryMin?: number | null; salaryMax?: number | null; currency?: string | null; salaryPeriod?: string | null;
};
type Interview = { id: string; scheduledAt: string; status?: string; durationMins?: number; location?: string | null; meetingUrl?: string | null; note?: string | null };
type Application = {
  id: string; status: string; createdAt: string; jobPost: EmployeeJob;
  matchScore?: number | null; matchBreakdown?: unknown;
  interviews?: Interview[]; coverLetter?: string | null;
  resumeSnapshot?: { resume?: { title?: string | null } } | null;
};
const CLOSED = new Set(['HIRED', 'REJECTED', 'WITHDRAWN']);
const SIZE = 10;

function statusClass(status: string) {
  if (status === 'IN_REVIEW') return s.review;
  if (status === 'INTERVIEW') return s.interview;
  if (status === 'OFFER' || status === 'HIRED') return s.positive;
  if (status === 'REJECTED') return s.negative;
  return '';
}
function upcoming(app: Application) {
  if (CLOSED.has(app.status)) return undefined;
  return (app.interviews || []).filter((item) => item.status !== 'CANCELLED' && item.status !== 'COMPLETED' && new Date(item.scheduledAt).getTime() >= Date.now()).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
}

function InterviewSummary({ interview }: { interview: Interview }) {
  const { t, locale } = useI18n();
  let meetingUrl: string | null = null;
  try {
    const url = new URL(interview.meetingUrl || '');
    if (url.protocol === 'https:' || url.protocol === 'http:') meetingUrl = url.href;
  } catch { /* Legacy or empty URLs are shown without a clickable link. */ }
  return <div className={s.interviewItem}>
    <p><WorkspaceIcon kind="calendar" /> {dateLabel(interview.scheduledAt, locale, true)}
      {interview.status && <span className={s.sub}>{t('ew.interview.' + interview.status)}</span>}
      {interview.durationMins ? <span className={s.sub}>{t('ew.interviewMinutes').replace('{n}', String(interview.durationMins))}</span> : null}
    </p>
    {interview.location && <p>{interview.location}</p>}
    {interview.note && <p style={{ whiteSpace: 'pre-wrap' }}>{interview.note}</p>}
    {meetingUrl && interview.status !== 'CANCELLED' && <a className={s.secondary} href={meetingUrl} target="_blank" rel="noopener noreferrer">{t('ew.joinInterview')}<WorkspaceIcon kind="external" /></a>}
  </div>;
}

export function ApplicationsWorkspace() {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const confirm = useConfirm();
  const resource = useEmployeeResource<Application>('/applications/mine');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selected = resource.items.find((item) => item.id === selectedId);
  const matches = (item: Application, key: string) => key === 'all' || (key === 'active' ? !CLOSED.has(item.status) : key === 'interviews' ? !CLOSED.has(item.status) && (item.status === 'INTERVIEW' || Boolean(upcoming(item))) : key === 'offers' ? item.status === 'OFFER' : CLOSED.has(item.status));
  const visible = useMemo(() => resource.items.filter((item) => matches(item, filter) && [item.jobPost.title, item.jobPost.company?.name, item.jobPost.city?.name].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => (Date.parse(b.createdAt) - Date.parse(a.createdAt)) * (sort === 'oldest' ? -1 : 1)), [resource.items, filter, search, sort]);
  useEffect(() => setPage(1), [filter, search, sort]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [page, filter, search, sort]);
  const safePage = Math.min(page, Math.max(1, Math.ceil(visible.length / SIZE)));

  async function withdraw(item: Application) {
    if (!(await confirm({ title: t('emp.withdrawConfirm'), confirmLabel: t('emp.withdraw'), tone: 'danger' }))) return;
    setBusy(true);
    try {
      await api('/applications/' + item.id + '/status', { method: 'POST', body: JSON.stringify({ status: 'WITHDRAWN' }) });
      resource.setItems((items) => items.map((row) => row.id === item.id ? { ...row, status: 'WITHDRAWN' } : row));
      resource.setError('');
    } catch (error) { resource.setError(error instanceof Error ? error.message : t('emp.withdrawFailed')); }
    finally { setBusy(false); }
  }
  function nextStep(item: Application) {
    const interview = upcoming(item);
    if (interview) return <strong>{t('emp.interview')}{' \u00b7 '}{dateLabel(interview.scheduledAt, locale, true)}</strong>;
    return t(CLOSED.has(item.status) ? item.status === 'HIRED' ? 'ew.completed' : 'ew.closed' : item.status === 'OFFER' ? 'ew.offerReceived' : 'ew.awaiting');
  }
  const retry = () => { void resource.reload().catch((error: Error) => resource.setError(error.message)); };

  return <section className={s.root} aria-label={t('applications')}>
    <div className={s.toolbar}><nav className={s.tabs} aria-label={t('ew.status')}>{['all', 'active', 'interviews', 'offers', 'closed'].map((key) => <button type="button" className={s.tab} key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{t('ew.' + key)}<span className={s.count}>{resource.items.filter((item) => matches(item, key)).length}</span></button>)}</nav><div className={s.tools}><SearchField value={search} onChange={setSearch} placeholder={t('ew.searchApplications')} /><select className={s.select} aria-label={t('ew.sort')} value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">{t('ew.newest')}</option><option value="oldest">{t('ew.oldest')}</option></select><Link className={s.primary} href="/jobs" aria-label={t('ew.findMore')} title={t('ew.findMore')}><span className={s.findMoreText}>{t('ew.findMore')}</span><WorkspaceIcon kind="external" /></Link></div></div>
    {resource.error && <ResourceError message={resource.error} onRetry={retry} />}
    {resource.loading ? <WorkspaceLoading /> : <div ref={scrollRef} className={s.scroll}>{!visible.length ? <WorkspaceEmpty title={t(resource.error && !resource.items.length ? 'ew.loadFailed' : resource.items.length ? 'ew.noResults' : 'ew.applicationsEmpty')} hint={resource.error && !resource.items.length ? undefined : t(resource.items.length ? 'ew.adjustSearch' : 'ew.applicationsEmptyHint')}>{!resource.error && !resource.items.length && <FindJobsAction />}</WorkspaceEmpty> : <table className={s.table}><colgroup><col style={{ width: '38%' }} /><col style={{ width: '17%' }} /><col style={{ width: '16%' }} /><col style={{ width: '23%' }} /><col style={{ width: '6%' }} /></colgroup><thead><tr><th scope="col">{t('ew.roleCompany')}</th><th scope="col">{t('ew.status')}</th><th scope="col">{t('ew.applied')}</th><th scope="col">{t('ew.nextStep')}</th><th scope="col"><span className="sr-only">{t('emp.details')}</span></th></tr></thead><tbody>{visible.slice((safePage - 1) * SIZE, safePage * SIZE).map((item) => <tr key={item.id}><td><div className={s.companyCell}><CompanyMark name={item.jobPost.company?.name || item.jobPost.title} logo={item.jobPost.company?.logoUrl} /><div className={s.companyText}><button type="button" className={s.titleButton} onClick={() => setSelectedId(item.id)}>{item.jobPost.title}</button><span className={s.sub}>{[item.jobPost.company?.name, localizedJobLocation(item.jobPost, t)].filter(Boolean).join(' \u00b7 ')}</span></div></div></td><td><span className={s.status + ' ' + statusClass(item.status)}><WorkspaceIcon kind={item.status === 'INTERVIEW' ? 'user' : item.status === 'HIRED' || item.status === 'OFFER' ? 'check' : 'clock'} />{item.status === 'NEW' ? t('ew.applied') : enumLabel('applicationStatus', item.status)}</span></td><td className={s.date} data-mobile="hide">{dateLabel(item.createdAt, locale)}</td><td className={s.nextStep}>{nextStep(item)}</td><td><button type="button" className={s.iconButton} aria-label={t('ew.applicationDetails') + ': ' + item.jobPost.title} onClick={() => setSelectedId(item.id)}><WorkspaceIcon kind="right" /></button></td></tr>)}</tbody></table>}</div>}
    {!resource.loading && <Pagination page={safePage} total={visible.length} size={SIZE} onChange={setPage} />}
    {selected && <ProfileDialog title={t('ew.applicationDetails')} wide onClose={() => setSelectedId(null)} busy={busy}><div className={s.detailBody}><div className={s.detailIdentity}><CompanyMark name={selected.jobPost.company?.name || selected.jobPost.title} logo={selected.jobPost.company?.logoUrl} /><div><h3>{selected.jobPost.title}</h3><span className={s.sub}>{selected.jobPost.company?.name}{' \u00b7 '}{localizedJobLocation(selected.jobPost, t)}</span></div></div><div className={s.detailMeta}><span className={s.status + ' ' + statusClass(selected.status)}>{selected.status === 'NEW' ? t('ew.applied') : enumLabel('applicationStatus', selected.status)}</span><span>{t('ew.applied')}: {dateLabel(selected.createdAt, locale)}</span></div>{Boolean(selected.interviews?.length) && <div className={s.detailSection}><h3>{t('ew.interviews')}</h3>{selected.interviews!.map((interview) => <InterviewSummary key={interview.id} interview={interview} />)}<span className={s.sub}>{t('ew.timezone').replace('{zone}', Intl.DateTimeFormat().resolvedOptions().timeZone)}</span></div>}{selected.resumeSnapshot?.resume?.title && <div className={s.detailSection}><h3>{t('ew.cv')}</h3><p>{selected.resumeSnapshot.resume.title}</p></div>}{selected.coverLetter && <div className={s.detailSection}><h3>{t('coverLetter')}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{selected.coverLetter}</p></div>}<div className={s.detailActions}>{selected.jobPost.status === 'PUBLISHED' && <Link className={s.secondary} href={jobDetailHref(selected.jobPost.id, '/dashboard/employee?tab=applications')}>{t('ew.viewJob')}<WorkspaceIcon kind="external" /></Link>}{selected.jobPost.company?.chatPeerUserId && <Link className={s.primary} href={'/messages?peer=' + encodeURIComponent(selected.jobPost.company.chatPeerUserId) + '&job=' + encodeURIComponent(selected.jobPost.id)}><WorkspaceIcon kind="message" />{t('chatWithRecruiter')}</Link>}{!CLOSED.has(selected.status) && <button type="button" className={s.danger} disabled={busy} onClick={() => void withdraw(selected)}>{t('emp.withdraw')}</button>}</div></div></ProfileDialog>}
  </section>;
}

