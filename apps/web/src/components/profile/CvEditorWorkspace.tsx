'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link, localeHref, useRouter } from '@/lib/navigation';
import { api, getSession } from '@/lib/api';
import { authLink } from '@/lib/authReturn';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_RESUME_INCLUSION, type ResumeInclusion, type ResumeTemplateKey } from '@job-talentio/shared';
import { FormField } from '@/components/ui/Field';
import { JobTitleInput } from '@/components/ui/JobTitleInput';
import { ResumePreview, type ResumePreviewDocument } from '@/components/resume/ResumePreview';
import { ProfileIcon } from './ProfileIcon';
import { ProfileDialog } from './ProfileDialog';
import { CVS_HREF, PROFILE_HREF } from './types';
import s from './ProfileWorkspace.module.css';
import c from './CvEditorWorkspace.module.css';

type Item = { id: string; name: string; level?: string };
type SourceLists = { skills: Item[]; experiences: Array<{ id: string; title: string; companyName: string }>; educations: Array<{ id: string; school: string }>; languages: Item[]; certifications: Item[] };
type Payload = {
  resume: { id: string; title: string; isPrimary: boolean; templateKey: ResumeTemplateKey; themeAccent?: string | null; inclusion: ResumeInclusion; hasFile: boolean; targetJobTitle?: { name: string } | null } | null;
  document: ResumePreviewDocument;
  source: SourceLists;
  checklist: { score: number; items: Array<{ id: string; ok: boolean; label: string; labelKey?: string; tip?: string; tipKey?: string }> };
};
type Draft = { title: string; jobTitle: string; templateKey: ResumeTemplateKey; inclusion: ResumeInclusion };
type IdField = 'experienceIds' | 'educationIds' | 'skillIds' | 'languageIds' | 'certificationIds';
const SECTIONS = [['summary', 'emp.summary'], ['experience', 'experience'], ['education', 'education'], ['skills', 'skills'], ['languages', 'languages'], ['certifications', 'certifications'], ['email', 'email'], ['phone', 'emp.phone']] as const;

function normalize(raw?: ResumeInclusion | null): ResumeInclusion {
  return { ...DEFAULT_RESUME_INCLUSION, ...raw, sections: { ...DEFAULT_RESUME_INCLUSION.sections, ...raw?.sections } };
}

export function CvEditorWorkspace() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const requestedId = params.get('resumeId') || '';
  const [payload, setPayload] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const idRef = useRef('');
  const roleRequired = useRef(false);
  const epoch = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'waiting' | 'saving' | 'failed'>('saved');
  const savedSignatures = useRef<Record<string, string>>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const [primaryBusy, setPrimaryBusy] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [zoom, setZoom] = useState(85);
  const previewScroll = useRef<HTMLDivElement>(null);
  const manualZoom = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const navigationPending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const currentEpoch = ++epoch.current;
    const session = getSession();
    if (!session) {
      window.location.href = localeHref(authLink('/login', window.location.pathname + window.location.search, 'EMPLOYEE'));
      return;
    }
    if (session.user.role !== 'EMPLOYEE') {
      window.location.href = localeHref(session.user.role === 'RECRUITER' ? '/dashboard/recruiter?tab=jobs' : '/');
      return;
    }
    setLoading(true); setError(''); setPayload(null); setDraft(null); draftRef.current = null; idRef.current = ''; roleRequired.current = false;
    try {
      await queue.current.catch(() => undefined);
      const data = await api<Payload>(`/profiles/me/resume-document${requestedId ? `?resumeId=${encodeURIComponent(requestedId)}` : ''}`);
      if (epoch.current !== currentEpoch) return;
      setPayload(data);
      if (data.resume) {
        const next: Draft = { title: data.resume.title, jobTitle: data.resume.targetJobTitle?.name || '', templateKey: data.resume.templateKey || 'classic', inclusion: normalize(data.resume.inclusion) };
        idRef.current = data.resume.id; savedSignatures.current[data.resume.id] = JSON.stringify(next);
        roleRequired.current = Boolean(next.jobTitle);
        draftRef.current = next; setDraft(next); setSaveState('saved');
      } else { idRef.current = ''; draftRef.current = null; setDraft(null); }
    } catch (error) { if (epoch.current === currentEpoch) setError(error instanceof Error ? error.message : t('emp.loadFailed')); }
    finally { if (epoch.current === currentEpoch) setLoading(false); }
  }, [requestedId, locale]);

  function fitPreview() {
    const width = previewScroll.current?.clientWidth;
    if (width) setZoom(Math.max(25, Math.min(100, Math.floor((width - 48) / 794 * 20) * 5)));
  }
  useEffect(() => {
    const element = previewScroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (!manualZoom.current) fitPreview(); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [Boolean(draft), expanded]);

  function update(patch: Partial<Draft>) {
    if (!draftRef.current || exportingRef.current || navigationPending.current) return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next; setDraft(next); setSaveState('waiting'); setDownloadUrl('');
  }

  const persist = useCallback(async () => {
    const snapshot = draftRef.current;
    const id = idRef.current;
    if (!snapshot || !id) return;
    const signature = JSON.stringify(snapshot);
    if (!snapshot.title.trim()) throw new Error(t('resumeTitleRequired'));
    if (roleRequired.current && !snapshot.jobTitle.trim()) throw new Error(t('resumeTargetRoleRequired'));
    if (snapshot.jobTitle.trim() && snapshot.jobTitle.trim().length < 2) throw new Error(t('resumeTargetRoleRequired'));
    const currentEpoch = epoch.current;
    const operation = queue.current.catch(() => undefined).then(async () => {
      if (savedSignatures.current[id] !== signature) {
        if (epoch.current === currentEpoch) setSaveState('saving');
        await api(`/profiles/me/resumes/${id}/builder`, { method: 'PATCH', body: JSON.stringify({ ...snapshot, jobTitle: snapshot.jobTitle.trim() || undefined, title: snapshot.title.trim() }) });
        savedSignatures.current[id] = signature;
        if (epoch.current === currentEpoch && snapshot.jobTitle.trim()) roleRequired.current = true;
      }
      if (epoch.current !== currentEpoch || signature !== JSON.stringify(draftRef.current)) return;
      setSaveState('saved'); setError('');
      try {
        const updated = await api<Payload>(`/profiles/me/resume-document?resumeId=${encodeURIComponent(id)}`);
        if (epoch.current === currentEpoch && signature === JSON.stringify(draftRef.current)) setPayload(updated);
      } catch (error) { if (epoch.current === currentEpoch) setError(error instanceof Error ? error.message : t('emp.loadFailed')); }
    });
    queue.current = operation;
    try { await operation; }
    catch (error) { if (epoch.current === currentEpoch) { setSaveState('failed'); setError(error instanceof Error ? error.message : t('pc.saveFailed')); } throw error; }
  }, [locale]);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (draftRef.current && idRef.current && JSON.stringify(draftRef.current) !== savedSignatures.current[idRef.current]) void persist().catch(() => undefined);
      epoch.current++;
    };
  }, [load, persist]);

  useEffect(() => {
    if (!draft || !idRef.current || JSON.stringify(draft) === savedSignatures.current[idRef.current]) return;
    timer.current = setTimeout(() => { void persist().catch((error) => { setSaveState('failed'); setError(error.message); }); }, 650);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [draft, persist]);

  useEffect(() => {
    function dirty() { return draftRef.current && idRef.current && JSON.stringify(draftRef.current) !== savedSignatures.current[idRef.current]; }
    function unload(event: BeforeUnloadEvent) { if (dirty()) { event.preventDefault(); event.returnValue = ''; } }
    function navigate(event: MouseEvent) {
      if (!dirty() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault(); event.stopPropagation();
      if (navigationPending.current) return;
      navigationPending.current = true; setLeaving(true);
      if (timer.current) clearTimeout(timer.current);
      void persist().then(() => router.push(url.pathname + url.search + url.hash)).catch((error) => { setError(error.message); navigationPending.current = false; setLeaving(false); });
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [persist, router]);

  function toggleSection(key: keyof ResumeInclusion['sections']) {
    if (!draftRef.current) return;
    update({ inclusion: { ...draftRef.current.inclusion, sections: { ...draftRef.current.inclusion.sections, [key]: !draftRef.current.inclusion.sections[key] } } });
  }
  function toggleItem(field: IdField, id: string, all: string[]) {
    if (!draftRef.current) return;
    const current = draftRef.current.inclusion[field] ?? all;
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    update({ inclusion: { ...draftRef.current.inclusion, [field]: all.every((value) => next.includes(value)) ? null : next } });
  }
  async function makePrimary() {
    if (!idRef.current || primaryBusy || exportingRef.current) return;
    setPrimaryBusy(true); setError('');
    try { await persist(); await api(`/profiles/me/resumes/${idRef.current}/builder`, { method: 'PATCH', body: JSON.stringify({ isPrimary: true }) }); setPayload((p) => p?.resume ? { ...p, resume: { ...p.resume, isPrimary: true } } : p); setNotice(t('emp.primaryResumeUpdated')); }
    catch (error) { setError(error instanceof Error ? error.message : t('emp.saveFailed')); }
    finally { setPrimaryBusy(false); }
  }
  async function exportPdf() {
    if (!idRef.current || exportingRef.current) return;
    exportingRef.current = true; setExporting(true); setError('');
    if (timer.current) clearTimeout(timer.current);
    try {
      await persist();
      const result = await api<{ downloadUrl?: string }>(`/profiles/me/resumes/${idRef.current}/export`, { method: 'POST' });
      setDownloadUrl(result.downloadUrl || ''); setConfirmExport(false); setNotice(t('emp.pdfExported'));
      setPayload((current) => current?.resume ? { ...current, resume: { ...current.resume, hasFile: true } } : current);
      try { const updated = await api<Payload>(`/profiles/me/resume-document?resumeId=${encodeURIComponent(idRef.current)}`); setPayload(updated); }
      catch (error) { setError(error instanceof Error ? error.message : t('emp.loadFailed')); }
    } catch (error) { setError(error instanceof Error ? error.message : t('emp.exportFailed')); setConfirmExport(false); }
    finally { exportingRef.current = false; setExporting(false); }
  }

  const preview = useMemo(() => payload?.document, [payload]);
  const isBusy = exporting || leaving || primaryBusy;
  function selections(field: IdField, key: keyof ResumeInclusion['sections'], title: string, rows: Array<{ id: string; label: string; detail?: string }>) {
    if (!draft || !draft.inclusion.sections[key] || !rows.length) return null;
    return <details className={c.selectionGroup} open><summary>{title}<ProfileIcon kind="chevron" /></summary><div>{rows.map((row) => <label key={row.id}><input type="checkbox" disabled={isBusy} checked={draft.inclusion[field] == null || draft.inclusion[field]!.includes(row.id)} onChange={() => toggleItem(field, row.id, rows.map((item) => item.id))} /><span>{row.label}{row.detail && <small>{row.detail}</small>}</span></label>)}</div></details>;
  }

  return <div className={`${s.root} ${c.root}`}>
    <nav className={c.breadcrumb} aria-label={t('pc.title')}><Link href={PROFILE_HREF}>{t('pc.title')}</Link><span>/</span><Link href={CVS_HREF}>{t('pc.myCvs')}</Link>{draft && <><span>/</span><span>{draft.title}</span></>}</nav>
    <header className={c.toolbar}><div className={c.editorHeading}><h1>{t('pc.editor')}</h1>{draft && <span className={saveState === 'failed' ? c.failedStatus : c.saveStatus} role="status">{saveState === 'saved' && <ProfileIcon kind="check" />}{t(isBusy && leaving ? 'saving' : saveState === 'saved' ? 'pc.saved' : saveState === 'saving' ? 'saving' : saveState === 'failed' ? 'pc.unsavedStatus' : 'pc.unsavedStatus')}</span>}</div><div className={c.toolbarActions}>{payload?.resume?.isPrimary ? <span className={s.primaryBadge}>{t('emp.primary')}</span> : <button type="button" className={s.secondary} disabled={isBusy || !draft} onClick={() => void makePrimary()}><ProfileIcon kind="star" />{t('emp.setPrimary')}</button>}<button type="button" className={s.secondary} disabled={!draft} onClick={() => setExpanded((value) => !value)}><ProfileIcon kind="eye" />{t(expanded ? 'pc.exitPreview' : 'pc.expandPreview')}</button><button type="button" className={s.primary} disabled={isBusy || !draft} onClick={() => setConfirmExport(true)}><ProfileIcon kind="download" />{t(exporting ? 'emp.exporting' : 'exportPdf')}</button></div></header>
    {error && <div className={s.error} role="alert"><span>{error}</span><button type="button" className={s.textButton} disabled={isBusy} onClick={() => draft ? void persist().catch((error) => setError(error.message)) : void load()}>{t('workspace.retry')}</button></div>}
    {notice && <div className={s.notice} role="status"><ProfileIcon kind="check" /><span>{notice}</span>{downloadUrl && <a className={s.textButton} href={downloadUrl} target="_blank" rel="noopener noreferrer">{t('pc.downloadFile')}<ProfileIcon kind="external" /></a>}<button className={s.iconButton} type="button" aria-label={t('closeDialog')} onClick={() => setNotice('')}><ProfileIcon kind="close" /></button></div>}
    {loading ? <div className={s.loading} role="status" aria-label={t('ui.loading')}><i /><i /></div> : !draft || !payload?.resume ? <div className={s.empty}><ProfileIcon /><h2>{t('pc.firstCv')}</h2><p>{t('pc.firstCvHint')}</p><div><Link className={s.primary} href={CVS_HREF}>{t('pc.backToCvs')}</Link></div></div> : <>
      {!payload.resume.hasFile && <p className={c.exportNote}><ProfileIcon kind="info" />{t('pc.exportNote')}</p>}
      <div className={`${c.workspace} ${expanded ? c.expanded : ''}`}>
        <aside className={c.settings} aria-label={t('pc.details')}>
          <fieldset className={s.resetFieldset} disabled={isBusy}>
            <section className={c.settingsSection}><h2>{t('pc.details')}</h2><FormField label={t('pc.cvName')} required><input value={draft.title} maxLength={160} required onChange={(event) => update({ title: event.target.value })} /></FormField><FormField label={t('resumeTargetRole')}><JobTitleInput focusSuggestions value={draft.jobTitle} onValueChange={(jobTitle) => update({ jobTitle })} /></FormField><FormField label={t('emp.template')}><div className={c.templateOptions}>{(['classic', 'modern', 'compact'] as const).map((value) => <button key={value} type="button" aria-pressed={draft.templateKey === value} onClick={() => update({ templateKey: value })}>{t({ classic: 'emp.templateClassic', modern: 'emp.templateModern', compact: 'emp.templateCompact' }[value])}</button>)}</div></FormField></section>
            <section className={c.settingsSection}><h2>{t('pc.includeSections')}</h2><div className={c.sectionChecks}>{SECTIONS.map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.inclusion.sections[key]} onChange={() => toggleSection(key)} />{t(label)}</label>)}</div></section>
          </fieldset>
          {payload.source && <>
            {selections('experienceIds', 'experience', t('experience'), payload.source.experiences.map((row) => ({ id: row.id, label: row.title, detail: row.companyName })))}
            {selections('educationIds', 'education', t('education'), payload.source.educations.map((row) => ({ id: row.id, label: row.school })))}
            {selections('skillIds', 'skills', t('skills'), payload.source.skills.map((row) => ({ id: row.id, label: row.name })))}
            {selections('languageIds', 'languages', t('languages'), payload.source.languages.map((row) => ({ id: row.id, label: row.name, detail: row.level })))}
            {selections('certificationIds', 'certifications', t('certifications'), payload.source.certifications.map((row) => ({ id: row.id, label: row.name })))}
          </>}
          <div className={c.profileLink}><Link href={PROFILE_HREF}><ProfileIcon kind="edit" />{t('pc.editCareer')}</Link><p>{t('pc.editorProfileHint')}</p></div>
          {payload.checklist && <details className={c.checklist}><summary>{t('pc.checklist')}<span>{payload.checklist.items.filter((item) => item.ok).length}/{payload.checklist.items.length}</span><ProfileIcon kind="chevron" /></summary><ul>{payload.checklist.items.map((item) => <li key={item.id} data-complete={item.ok}><ProfileIcon kind={item.ok ? 'check' : 'info'} /><div><strong>{item.labelKey ? t(item.labelKey) : item.label}</strong>{!item.ok && <p>{item.tipKey ? t(item.tipKey) : item.tip}</p>}</div></li>)}</ul></details>}
        </aside>
        <section className={c.previewPane} aria-label={t('pc.documentPreview')}><header className={c.previewToolbar}><strong>{t('pc.documentPreview')}</strong><div><button type="button" className={s.iconButton} disabled={zoom <= 25} onClick={() => { manualZoom.current = true; setZoom((value) => Math.max(25, value - 10)); }} aria-label={t('pc.zoomOut')}>−</button><span>{zoom}%</span><button type="button" className={s.iconButton} disabled={zoom >= 125} onClick={() => { manualZoom.current = true; setZoom((value) => Math.min(125, value + 10)); }} aria-label={t('pc.zoomIn')}>+</button></div></header><div ref={previewScroll} className={c.previewScroll}>{preview && <div className={c.paper} style={{ zoom: zoom / 100 }}><ResumePreview document={preview} templateKey={draft.templateKey} themeAccent={payload.resume.themeAccent || '#25365c'} /></div>}</div></section>
      </div>
    </>}
    {confirmExport && <ProfileDialog title={t('exportPdfConfirmTitle')} onClose={() => setConfirmExport(false)} busy={exporting}><div className={s.dialogBody}><p className={s.muted}>{t(payload?.resume?.hasFile ? 'exportPdfReplaceWarning' : 'exportPdfAttachWarning')}</p><p className={s.inlineNote}><ProfileIcon kind="info" />{t('pc.exportNotApply')}</p>{error && <div className={s.error} role="alert">{error}</div>}<footer className={s.dialogFooter}><button className={s.secondary} type="button" disabled={exporting} onClick={() => setConfirmExport(false)}>{t('cancel')}</button><button className={s.primary} type="button" disabled={exporting} onClick={() => void exportPdf()}>{t(exporting ? 'emp.exporting' : 'exportPdf')}</button></footer></div></ProfileDialog>}
  </div>;
}
