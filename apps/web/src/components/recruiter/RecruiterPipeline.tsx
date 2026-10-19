'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { SearchField, WorkspaceEmpty, WorkspaceLoading, dateLabel } from '@/components/employee/WorkspacePrimitives';
import { MatchBreakdownPanel } from '@/components/ui/MatchBreakdownPanel';
import { WorkspaceSelect } from '@/components/jobs/WorkspaceSelect';
import { RecruiterAvatar, JobContextSelect } from './RecruiterPrimitives';
import s from './RecruiterWorkspace.module.css';

const STAGES = ['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];
type Props = { companyId: string; companyName: string; jobs: any[]; selectedJob: string; onJobChange: (id: string) => void; applicants: any[]; loading: boolean; applicationId?: string; templates: Array<{ id: string; name: string; body: string }>; onReload: () => Promise<void>; onTemplates: () => void; onFlash: (message: string, tone?: 'success' | 'error') => void };

export function RecruiterPipeline({ companyId, companyName, jobs, selectedJob, onJobChange, applicants, loading, applicationId, templates, onReload, onTemplates, onFlash }: Props) {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const confirm = useConfirm();
  const [view, setView] = useState<'board' | 'list'>(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches ? 'list' : 'board');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('newest');
  const [active, setActive] = useState<string | null>(null);
  const [section, setSection] = useState('profile');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bulk, setBulk] = useState(false);
  const [message, setMessage] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [channels, setChannels] = useState({ app: true, email: false, telegram: false });
  const [preview, setPreview] = useState(false);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [interviewsLoading, setInterviewsLoading] = useState(false);
  const candidate = applicants.find((item) => item.id === active);
  const job = jobs.find((item) => item.id === selectedJob);
  useEffect(() => { setActive(null); setSelected([]); setBulk(false); setStatus(''); setError(''); }, [selectedJob]);
  useEffect(() => { setSelected((ids) => ids.filter((id) => applicants.some((item) => item.id === id))); }, [applicants]);
  useEffect(() => {
    if (!active || section !== 'interviews') return;
    let alive = true; setInterviewsLoading(true); setError('');
    api<any[]>('/applications/' + active + '/interviews').then((data) => { if (alive) setInterviews(data); }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : t('ew.loadFailed')); }).finally(() => { if (alive) setInterviewsLoading(false); });
    return () => { alive = false; };
  }, [active, section, locale]);
  const visible = useMemo(() => applicants.filter((item) => (!status || item.status === status) && [item.profile?.user?.fullName, item.profile?.headline].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => sort === 'match' ? (b.matchScore ?? -1) - (a.matchScore ?? -1) : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [applicants, status, query, sort]);
  useEffect(() => { if (applicationId && applicants.some((item) => item.id === applicationId)) { setActive(applicationId); setSection('profile'); } }, [applicationId, selectedJob, applicants]);
  const toggle = (id: string) => { if (!selected.includes(id) && selected.length >= 50) { setError(t('rw.bulkLimit')); return; } setSelected((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]); };
  async function setApplicationStatus(id: string, value: string) {
    if (busy) return;
    if ((value === 'REJECTED' || value === 'HIRED') && !await confirm({ title: enumLabel('applicationStatus', value), message: applicants.find((item) => item.id === id)?.profile?.user?.fullName, confirmLabel: t('rec.saveChanges'), ...(value === 'REJECTED' ? { tone: 'danger' as const } : {}) })) return;
    setBusy(true); setError('');
    try { await api('/applications/' + id + '/status', { method: 'POST', body: JSON.stringify({ status: value }) }); await onReload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('ew.loadFailed')); }
    finally { setBusy(false); }
  }
  async function viewCv(id: string) {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try { const data = await api<{ url: string }>('/applications/' + id + '/resume-download'); if (tab) tab.location.href = data.url; else window.location.assign(data.url); }
    catch (reason) { tab?.close(); setError(reason instanceof Error ? reason.message : t('viewCvFailed')); }
  }
  async function schedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!candidate || busy) return;
    const form = new FormData(event.currentTarget), node = event.currentTarget;
    setBusy(true); setError('');
    try {
      await api('/applications/' + candidate.id + '/interviews', { method: 'POST', body: JSON.stringify({ scheduledAt: new Date(String(form.get('scheduledAt'))).toISOString(), durationMins: Number(form.get('durationMins') || 60), meetingUrl: String(form.get('meetingUrl') || ''), location: String(form.get('location') || ''), note: String(form.get('note') || '') }) });
      node.reset(); setInterviews(await api<any[]>('/applications/' + candidate.id + '/interviews')); await onReload(); onFlash(t('rec.interviewScheduled'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('ew.loadFailed')); }
    finally { setBusy(false); }
  }
  async function sendBulk() {
    if (!selected.length || busy || (!nextStatus && !message.trim())) return;
    if (selected.length > 50) { setError(t('rw.bulkLimit')); return; }
    if (message.trim() && !channels.app && !channels.email && !channels.telegram) { setError(t('rec.bulkChooseTarget')); return; }
    if (!await confirm({ title: t('rw.sendUpdate'), message: t('rec.selectedCount').replace('{n}', String(selected.length)) + (nextStatus ? ' | ' + enumLabel('applicationStatus', nextStatus) : ''), confirmLabel: t('rw.sendUpdate') })) return;
    setBusy(true); setError('');
    try {
      const result = await api<any>('/bulk-comms/campaigns', { method: 'POST', body: JSON.stringify({ companyId, jobPostId: selectedJob, applicationIds: selected, toStatus: nextStatus || undefined, templateId: templateId || undefined, messageBody: message.trim() || undefined, channels: message.trim() ? channels : undefined }) });
      const rows = result.recipients || []; const count = (key: string) => rows.filter((row: any) => row.deliveryStatus === key).length;
      onFlash(t('rec.bulkDoneSent').replace('{n}', String(count('SENT'))) + ' | ' + t('rec.bulkDoneSkipped').replace('{n}', String(count('SKIPPED_OPTED_OUT'))) + ' | ' + t('rec.bulkDoneFailed').replace('{n}', String(count('FAILED'))));
      setSelected([]); setBulk(false); setMessage(''); setTemplateId(''); setNextStatus(''); await onReload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('rec.bulkActionFailed')); }
    finally { setBusy(false); }
  }
  const previewText = message.replace(/\{\{name\}\}/g, applicants.find((item) => selected.includes(item.id))?.profile?.user?.fullName || '').replace(/\{\{jobTitle\}\}/g, job?.title || '').replace(/\{\{companyName\}\}/g, companyName).replace(/\{\{status\}\}/g, nextStatus ? enumLabel('applicationStatus', nextStatus) : '');
  return <>
    <div className={s.context}><Link className={s.textButton} href="/dashboard/recruiter?tab=jobs"><WorkspaceIcon kind="left" />{t('jobs')}</Link><JobContextSelect jobs={jobs} value={selectedJob} onChange={onJobChange} allowBrowse={false} />{selectedJob && <Link href={'/talent?matchJobId=' + selectedJob + '&company=' + companyId + '&sort=match'} className={s.textButton}>{t('findTalent')}<WorkspaceIcon kind="arrow" /></Link>}</div>
    <div className={s.toolbar}><div className={s.actions}><button className={view === 'board' ? s.secondary : s.textButton} aria-pressed={view === 'board'} onClick={() => setView('board')}>{t('rw.board')}</button><button className={view === 'list' ? s.secondary : s.textButton} aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('rw.list')}</button></div><SearchField value={query} onChange={setQuery} placeholder={t('rw.searchApplicants')} /><WorkspaceSelect value={status} options={[{ value: '', label: t('rw.allApplicants') }, ...STAGES.map((value) => ({ value, label: enumLabel('applicationStatus', value) }))]} label={t('status')} onChange={setStatus} /><WorkspaceSelect value={sort} options={[{ value: 'newest', label: t('rw.newest') }, { value: 'match', label: t('talent.sortMatch') }]} label={t('sortBy')} onChange={setSort} /><button className={s.textButton} onClick={onTemplates}>{t('rec.templatesHistory')}</button></div>
    {error && <div className={s.notice} role="alert">{error}</div>}
    {selected.length > 0 && <div className={s.bulkBar}><strong>{t('rec.selectedCount').replace('{n}', String(selected.length))}</strong><span className={s.emptyNote}>{t('rw.bulkLimit')}</span><button className={s.textButton} onClick={() => setSelected([])}>{t('rw.clearSelection')}</button><button className={s.secondary} onClick={() => setBulk((open) => !open)} aria-expanded={bulk}>{t('rw.bulkActions')}</button></div>}
    {bulk && selected.length > 0 && <div className={s.bulkComposer}><div className={s.bulkRecipients} aria-label={t('ui.candidate')}>{applicants.filter((item) => selected.includes(item.id)).map((item) => <span key={item.id} className={s.tag}>{item.profile?.user?.fullName}</span>)}</div><div className={s.fields}><div className={s.fieldRow}><label>{t('rec.moveToStage')}<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}><option value="">{t('rec.keepStage')}</option>{STAGES.map((value) => <option key={value} value={value}>{enumLabel('applicationStatus', value)}</option>)}</select></label><label>{t('rec.template')}<select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setMessage(templates.find((item) => item.id === event.target.value)?.body || ''); }}><option value="">{t('rec.customNone')}</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>{t('rec.messageOptional')}<textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2} maxLength={5000} /></label></div><div className={s.actions} style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><div className={s.actions}>{(['app', 'email', 'telegram'] as const).map((key) => <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={channels[key]} onChange={(event) => setChannels((current) => ({ ...current, [key]: event.target.checked }))} />{t(key === 'app' ? 'rec.channelApp' : key === 'email' ? 'email' : 'telegram')}</label>)}</div><button className={s.textButton} onClick={() => setPreview((open) => !open)}>{t('rw.previewMessage')}</button><button className={s.primary} disabled={busy || (!message.trim() && !nextStatus)} onClick={() => void sendBulk()}>{t(busy ? 'saving' : 'rw.sendUpdate')}</button></div>{preview && <p style={{ whiteSpace: 'pre-wrap', color: '#6b7890', lineHeight: 1.8 }}>{previewText}</p>}</div></div>}
    {!selectedJob ? <WorkspaceEmpty title={t('rec.pipelineEmpty')} /> : <div className={s.pipelineLayout}><div className={s.pipelineMain}>
      {loading ? <WorkspaceLoading /> : view === 'board' ? <div className={s.board}>{STAGES.filter((stage) => !status || stage === status).map((stage) => { const rows = visible.filter((item) => item.status === stage); return <section className={s.column} key={stage}><header><label><input type="checkbox" checked={rows.length > 0 && rows.every((item) => selected.includes(item.id))} disabled={!rows.length} onChange={() => setSelected((ids) => rows.every((item) => ids.includes(item.id)) ? ids.filter((id) => !rows.some((item) => item.id === id)) : [...new Set([...ids, ...rows.map((item) => item.id)])].slice(0, 50))} />{enumLabel('applicationStatus', stage)}</label><span className={s.count}>{rows.length}</span></header><div className={s.columnBody}>{!rows.length && <p className={s.emptyNote}>{t('rec.noCandidates')}</p>}{rows.map((item) => <article key={item.id} className={s.applicant} data-active={active === item.id}><div><input type="checkbox" checked={selected.includes(item.id)} aria-label={t('rec.selectCandidate').replace('{name}', item.profile?.user?.fullName || '')} onChange={() => toggle(item.id)} /><RecruiterAvatar name={item.profile?.user?.fullName || ''} src={item.profile?.user?.avatarUrl} /><div style={{ minWidth: 0 }}><button onClick={() => { setActive(item.id); setSection('profile'); setError(''); }}>{item.profile?.user?.fullName}</button><span className={s.sub}>{item.profile?.headline || '-'}</span></div></div><footer>{item.matchScore != null && <button className={s.miniScore} title={t('rw.matchForJob')} onClick={() => { setActive(item.id); setSection('match'); }}>{Math.round(item.matchScore)}%</button>}<time dateTime={item.createdAt}>{dateLabel(item.createdAt, locale)}</time><button aria-label={t('viewProfile')} onClick={() => { setActive(item.id); setSection('profile'); }}><WorkspaceIcon kind="right" /></button></footer></article>)}</div></section>; })}</div> : <div className={s.tableWrap} data-mobile-list="true"><table className={s.table}><thead><tr><th><input type="checkbox" aria-label={t('selectAll')} checked={visible.length > 0 && visible.every((item) => selected.includes(item.id))} onChange={(event) => setSelected(event.target.checked ? visible.slice(0, 50).map((item) => item.id) : [])} /></th><th>{t('rw.application')}</th><th>{t('rw.matchForJob')}</th><th>{t('status')}</th><th>{t('rw.applied')}</th><th>{t('rw.actions')}</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td style={{ minWidth: 0 }}><input type="checkbox" aria-label={item.profile?.user?.fullName} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /></td><td><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><RecruiterAvatar name={item.profile?.user?.fullName || ''} src={item.profile?.user?.avatarUrl} /><div><button className={s.title} onClick={() => { setActive(item.id); setSection('profile'); }}>{item.profile?.user?.fullName}</button><span className={s.sub}>{item.profile?.headline}</span></div></div></td><td data-label={t('rw.matchForJob')}><span className={s.miniScore}>{item.matchScore == null ? '-' : Math.round(item.matchScore) + '%'}</span></td><td data-label={t('status')}><span className={s.status} data-status={item.status}>{enumLabel('applicationStatus', item.status)}</span></td><td data-label={t('rw.applied')}>{dateLabel(item.createdAt, locale)}</td><td><button className={s.textButton} onClick={() => { setActive(item.id); setSection('profile'); }}>{t('viewProfile')}</button></td></tr>)}</tbody></table>{!visible.length && <WorkspaceEmpty title={t('rec.noCandidates')} />}</div>}
    </div>{candidate && <aside className={s.drawer} aria-label={candidate.profile?.user?.fullName}><div className={s.drawerHead}><button className={s.icon} style={{ float: 'right' }} onClick={() => setActive(null)} aria-label={t('close')}>×</button><div><RecruiterAvatar name={candidate.profile?.user?.fullName || ''} src={candidate.profile?.user?.avatarUrl} /><div><h2>{candidate.profile?.user?.fullName}</h2><span className={s.sub}>{candidate.profile?.headline}</span></div></div><select value={candidate.status} disabled={busy} onChange={(event) => void setApplicationStatus(candidate.id, event.target.value)} aria-label={t('status')}>{STAGES.map((value) => <option value={value} key={value}>{enumLabel('applicationStatus', value)}</option>)}</select><div className={s.actions}><Link className={s.primary} href={'/messages?peer=' + candidate.profile?.user?.id + '&job=' + selectedJob + '&role=RECRUITER'}><WorkspaceIcon kind="message" />{t('rec.chat')}</Link>{candidate.hasResumeFile && <button className={s.secondary} onClick={() => void viewCv(candidate.id)}><WorkspaceIcon kind="file" />{t('viewCv')}</button>}</div></div><nav className={s.tabs} style={{ paddingInline: 22, gap: 16 }} aria-label={t('rw.application')}>{[['profile', 'rw.profile'], ['screening', 'rw.screening'], ['interviews', 'rw.interviews'], ['match', 'rw.matchDetails']].map(([value, key]) => <button key={value} aria-current={section === value ? 'page' : undefined} onClick={() => setSection(value)}>{t(key)}</button>)}</nav><div className={s.drawerBody}>
      {section === 'profile' && <><section><h3>{t('rw.application')}</h3><p>{dateLabel(candidate.createdAt, locale, true)}</p><Link className={s.textButton} href={'/candidates/' + candidate.profile?.id + '?matchJobId=' + selectedJob + '&company=' + companyId}>{t('viewProfile')}<WorkspaceIcon kind="external" /></Link></section>{candidate.coverLetter && <section><h3>{t('coverLetter')}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{candidate.coverLetter}</p></section>}<section><h3>{t('skills')}</h3><div className={s.tags}>{(candidate.profile?.skills || []).map((item: any) => <span key={item.id || item.skill?.slug} className={s.tag}>{item.skill?.name || item.name}</span>)}</div></section></>}
      {section === 'screening' && ((candidate.answers || []).length ? candidate.answers.map((answer: any) => <section key={answer.id || answer.questionId}><h3>{answer.question?.question}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{answer.answer === 'Yes' ? t('job.yes') : answer.answer === 'No' ? t('job.no') : answer.answer}</p></section>) : <p>{t('rec.answersNone')}</p>)}
      {section === 'match' && <><h3>{t('rw.matchForJob')}</h3><strong>{job?.title}</strong><p>{t('rw.matchHint')}</p>{candidate.matchBreakdown ? <MatchBreakdownPanel breakdown={candidate.matchBreakdown} /> : <p>{t('noData')}</p>}</>}
      {section === 'interviews' && <><section>{interviewsLoading ? <p>{t('rec.loading')}</p> : interviews.map((item) => <div key={item.id} className={s.document}><WorkspaceIcon kind="calendar" /><div><strong>{dateLabel(item.scheduledAt, locale, true)}</strong><span className={s.sub}>{item.durationMins} {t('minutes')}</span>{item.meetingUrl && <a className={s.textButton} href={item.meetingUrl} target="_blank" rel="noopener noreferrer">{t('rec.meetingUrl')}</a>}</div></div>)}</section><h3>{t('rec.scheduleInterview')}</h3><form className={s.fields} onSubmit={(event) => void schedule(event)}><label>{t('rec.interviewTime')}<input name="scheduledAt" type="datetime-local" required min={(() => { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 16); })()} /></label><span className={s.emptyNote}>{t('rw.timezone')} ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span><label>{t('duration')}<select name="durationMins" defaultValue="60">{[15, 30, 45, 60, 90, 120].map((value) => <option key={value} value={value}>{value} min</option>)}</select></label><label>{t('rec.meetingUrl')}<input name="meetingUrl" type="url" placeholder="https://..." /></label><label>{t('city')}<input name="location" maxLength={300} /></label><label>{t('note')}<textarea name="note" rows={3} maxLength={2000} /></label><button className={s.primary} type="submit" disabled={busy}>{t(busy ? 'saving' : 'rec.scheduleInterview')}</button></form></>}
    </div></aside>}</div>}
  </>;
}
