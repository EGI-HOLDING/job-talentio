'use client';
import { useApiResource } from '@/lib/useApiResource';
import { useSessionIdentity } from '@/lib/useSessionIdentity';
import { useMatchingStatus } from '@/lib/useMatchingStatus';
import { EmployeeEvidenceReview } from './EmployeeEvidenceReview';
import { useEmployeeIntentText } from '@/lib/i18n/employeeIntent';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link, localeHref, useRouter } from '@/lib/navigation';
import { api, getSession, saveSession, type AuthSession } from '@/lib/api';
import { authLink } from '@/lib/authReturn';
import { useOnboardingText } from '@/lib/i18n/onboarding';
import { countryName } from '@/components/onboarding/PreferenceFields';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { scoreProfileCompleteness, MAX_RESUMES_PER_PROFILE } from '@job-talentio/shared';
import { FormField } from '@/components/ui/Field';
import { ProfileIcon } from './ProfileIcon';
import { ProfileForms } from './ProfileForms';
import { ProfileDialog } from './ProfileDialog';
import { CvUploadDialog } from './CvUploadDialog';
import { CvFileDrop } from './CvFileDrop';
import { CVS_HREF, PROFILE_HREF, cvFileError, type CareerProfile, type ProfileEditor, type Resume } from './types';
import s from './ProfileWorkspace.module.css';

function Section({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return <section id={id} data-profile-section className={s.section}><header className={s.sectionHeading}><h2>{title}</h2>{action}</header>{children}</section>;
}

export function ProfileCvWorkspace() {
  const intentText=useEmployeeIntentText();
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const onboardingText = useOnboardingText();
  const router = useRouter();
  const searchParams = useSearchParams();
  const showCvs = searchParams.get('section') === 'cvs';
  const identity=useSessionIdentity();
  const profileResource=useApiResource<CareerProfile>(identity?'/profiles/me':null);
  const profile=profileResource.data||null;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const loading=profileResource.loading;
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editor, setEditor] = useState<ProfileEditor | null>(null);
  const preferenceEditorOpened = useRef(false);
  const requestedSection = searchParams.get('section');
  useEffect(() => {
    if (requestedSection !== 'preferences') { preferenceEditorOpened.current = false; return; }
    if (profile && !preferenceEditorOpened.current) {
      preferenceEditorOpened.current = true;
      setEditor({ kind: 'basics' });
    }
  }, [requestedSection, profile?.id]);
  const [importing, setImporting] = useState<{ resumeId?: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuUp, setMenuUp] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [removing, setRemoving] = useState<{ kind: string; id: string; name: string } | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [fileDialog, setFileDialog] = useState<{ kind: 'preview' | 'replace'; resume: Resume } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const fileRequest = useRef(0);
  const [evidenceReview,setEvidenceReview]=useState<Resume|null>(null);
  const [resumeEditor, setResumeEditor] = useState<Resume | null>(null);
  const [resumeError, setResumeError] = useState('');

  const load=useCallback(async()=>profileResource.reload(),[profileResource.reload]);
  useEffect(()=>{
    let active=true;setSession(getSession());
    api<AuthSession>('/auth/me').then(fresh=>{if(active){saveSession(fresh);setSession(fresh);}}).catch(()=>{});
    return()=>{active=false;};
  },[identity]);
  useEffect(()=>{if(profileResource.error)setError(profileResource.error);},[profileResource.error]);
  const processing=Boolean(profile?.resumes.some(row=>['PENDING','PROCESSING'].includes(row.parseStatus||'')&&row.hasFile));
  useMatchingStatus(processing,()=>{void load().catch(()=>{});});
  useEffect(() => {
    if (!menu) return;
    function outside(event: MouseEvent) { if (!(event.target as Element).closest('[data-cv-menu]')) setMenu(null); }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') { setMenu(null); menuButton.current?.focus(); } }
    document.addEventListener('click', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', key); };
  }, [menu]);
  useEffect(() => { setMenu(null); }, [showCvs]);

  async function refresh(message?: string) {
    if (message) setMessage(message);
    try { await load(); setError(''); } catch (error) { setError(error instanceof Error ? error.message : t('emp.loadFailed')); }
  }
  async function action(id: string, fn: () => Promise<void>) {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setBusy(id); setError('');
    try { await fn(); }
    catch (error) { setError(error instanceof Error ? error.message : t('emp.saveFailed')); }
    finally { actionInFlight.current = false; setBusy(null); }
  }
  function canAddCv() {
    if ((profile?.resumes.length || 0) < MAX_RESUMES_PER_PROFILE) return true;
    setError(t('resumeQuotaReached').replace('{max}', String(MAX_RESUMES_PER_PROFILE))); return false;
  }
  function openImport(resumeId?: string) { if (resumeId || canAddCv()) { setError(''); setImporting({ resumeId }); } }
  async function setPrimary(resume: Resume) {
    setMenu(null);
    await action(`primary-${resume.id}`, async () => { await api(`/profiles/me/resumes/${resume.id}`, { method: 'PATCH', body: JSON.stringify({ isPrimary: true }) }); await refresh(t('emp.primaryResumeUpdated')); });
  }
  function openFile(resume: Resume, kind: 'preview' | 'replace') {
    setMenu(null); setFileDialog({ kind, resume }); setFile(null); setFileError(''); setFileUrl('');
    const request = ++fileRequest.current;
    setFileLoading(kind === 'preview');
    if (kind === 'preview') void api<{ url: string }>(`/profiles/me/resumes/${resume.id}/download`)
      .then((data) => { if (mounted.current && request === fileRequest.current) setFileUrl(data.url); })
      .catch((error) => { if (mounted.current && request === fileRequest.current) setFileError(error.message || t('emp.loadFailed')); })
      .finally(() => { if (mounted.current && request === fileRequest.current) setFileLoading(false); });
  }
  async function replaceFile(event: FormEvent) {
    event.preventDefault();
    if (!file || !fileDialog || actionInFlight.current) return;
    actionInFlight.current = true; setBusy('replace'); setFileError('');
    try {
      const fd = new FormData(); fd.append('file', file);
      await api(`/profiles/me/resumes/${fileDialog.resume.id}/file`, { method: 'POST', body: fd });
      setFileDialog(null); await refresh(t('resumeFileAttached'));
    } catch (error) { setFileError(error instanceof Error ? error.message : t('emp.attachFailed')); }
    finally { actionInFlight.current = false; setBusy(null); }
  }
  async function remove() {
    if (!removing || actionInFlight.current) return;
    actionInFlight.current = true; setBusy('delete'); setRemoveError('');
    try {
      await api(`/profiles/me/${removing.kind}/${removing.id}`, { method: 'DELETE' });
      setRemoving(null); await refresh(t(removing.kind === 'resumes' ? 'emp.cvRemoved' : 'pc.saved'));
    } catch (error) { setRemoveError(error instanceof Error ? error.message : t('emp.deleteFailed')); }
    finally { actionInFlight.current = false; setBusy(null); }
  }
  async function saveResumeDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resumeEditor || actionInFlight.current) return;
    actionInFlight.current = true; setBusy('resume-details'); setResumeError('');
    const fd = new FormData(event.currentTarget);
    try {
      await api(`/profiles/me/resumes/${resumeEditor.id}`, { method: 'PATCH', body: JSON.stringify({ title: String(fd.get('title')).trim() }) });
      setResumeEditor(null); await refresh(t('pc.saved'));
    } catch (error) { setResumeError(error instanceof Error ? error.message : t('emp.saveFailed')); }
    finally { actionInFlight.current = false; setBusy(null); }
  }

  const completeness = useMemo(() => profile ? scoreProfileCompleteness({ ...profile, email: profile.user.email, emailVerified: profile.user.emailVerified, avatarUrl: profile.user.avatarUrl, telegramLinked: session?.user.telegramLinked }) : null, [profile, session]);
  const date = (value?: string | null, yearOnly = false, withDay = false) => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat(locale === 'uz' ? 'uz-UZ' : locale === 'ru' ? 'ru-RU' : locale === 'id' ? 'id-ID' : 'en-US', { year: 'numeric', ...(yearOnly ? {} : { month: 'short' }), ...(withDay ? { day: 'numeric' } : {}) }).format(new Date(value)) : '';
  const range = (start?: string | null, end?: string | null, current = false, yearOnly = false) => [date(start, yearOnly), current ? t('emp.current') : date(end, yearOnly)].filter(Boolean).join(' - ');
  const editButton = (kind: ProfileEditor['kind'], id?: string) => <button className={s.textButton} type="button" onClick={() => setEditor({ kind, id })}><ProfileIcon kind="edit" />{t('emp.edit')}</button>;
  const addButton = (kind: Exclude<ProfileEditor['kind'], 'phone'>) => <button className={s.addButton} type="button" onClick={() => setEditor({ kind })}><ProfileIcon kind="plus" />{t({ experience: 'pc.addExperience', education: 'pc.addEducation', certification: 'pc.addCertification', skills: 'addSkill', languages: 'pc.addLanguage', basics: 'pc.editBasics' }[kind])}</button>;
  const entryActions = (kind: ProfileEditor['kind'], collection: string, id: string, name: string) => <div className={s.entryActions}><button className={s.iconButton} type="button" aria-label={`${t('emp.edit')}: ${name}`} onClick={() => setEditor({ kind, id })}><ProfileIcon kind="edit" /></button><button className={s.iconButton} type="button" aria-label={`${t('pc.remove')}: ${name}`} onClick={() => { setRemoveError(''); setRemoving({ kind: collection, id, name }); }}><ProfileIcon kind="trash" /></button></div>;

  return <div className={s.root}>
    <h1 className="sr-only">{t('pc.title')}</h1>
    <nav className={s.tabs} aria-label={t('pc.title')}><Link href={PROFILE_HREF} aria-current={!showCvs ? 'page' : undefined} scroll={false}>{t('pc.myProfile')}</Link><Link href={CVS_HREF} aria-current={showCvs ? 'page' : undefined} scroll={false}>{t('pc.myCvs')}</Link></nav>
    {error && <div className={s.error} role="alert"><span>{error}</span><button type="button" className={s.textButton} disabled={loading} onClick={() => { setError(''); void refresh(); }}>{t('workspace.retry')}</button></div>}
    {message && <div className={s.notice} role="status"><ProfileIcon kind="check" /><span>{message}</span><button type="button" className={s.iconButton} aria-label={t('closeDialog')} onClick={() => setMessage('')}><ProfileIcon kind="close" /></button></div>}
    {loading ? <div className={s.loading} role="status" aria-label={t('ui.loading')}><i /><i /><i /></div> : profile && (showCvs ? <section className={s.library} aria-label={t('pc.myCvs')}>
      <header className={s.libraryHeading}><div className={s.libraryActions}><small>{t('pc.cvCount').replace('{n}', String(profile.resumes.length)).replace('{max}', String(MAX_RESUMES_PER_PROFILE))}</small><button className={s.secondary} type="button" onClick={() => openImport()}><ProfileIcon kind="upload" />{t('cv.upload')}</button></div></header><p className={s.profileHint}>{t('cv.primaryHint')}</p>
      {profile.resumes.length ? <div className={s.cvTable}>
        <div className={s.cvTableHeader} aria-hidden="true"><span>{t('pc.cv')}</span><span>{t('pc.fileStatus')}</span><span className={s.cvDate}>{t('pc.updated')}</span><span>{t('pc.actions')}</span></div>
        {profile.resumes.map((resume) => <article key={resume.id} className={s.cvRow} aria-label={resume.title}>
          <div className={s.cvIdentity}><span className={s.documentThumb}><ProfileIcon /></span><div><div className={s.cvName}><strong>{resume.title}</strong>{resume.isPrimary && <span className={s.primaryBadge}>{t('emp.primary')}</span>}</div><p>{resume.hasFile ? t('pc.attached') : t('pc.noFile')}</p></div></div>
          <div className={s.cvStatus}>{true&&resume.currentVersionId&&<button type="button" className={s.textButton} style={{display:'block',marginBottom:6,textAlign:'left',whiteSpace:'normal'}} onClick={()=>setEvidenceReview(resume)}>{intentText('reviewCVMatchingEvidence')}</button>}<span className={resume.parseStatus==='READY'?s.badge:s.warningBadge}>{t(resume.parseStatus==='READY'?'cv.ready':resume.parseStatus==='FAILED'?'cv.failed':resume.hasFile?'cv.processing':'pc.noFile')}</span>{resume.parseStatus==='FAILED'&&<button type="button" className={s.textButton} disabled={Boolean(busy)} onClick={()=>void action('retry-'+resume.id,async()=>{await api('/profiles/me/resumes/'+resume.id+'/parse',{method:'POST'});await refresh();})}>{t('cv.retry')}</button>}</div>
          <time className={s.cvDate} dateTime={resume.updatedAt}>{date(resume.updatedAt, false, true)}</time>
          <div className={s.rowActions}>{resume.hasFile && <button className={s.secondary} type="button" disabled={Boolean(busy)} onClick={() => openFile(resume, 'preview')} aria-label={`${t('pc.preview')}: ${resume.title}`}><ProfileIcon kind="eye" /><span>{t('pc.preview')}</span></button>}<div className={s.overflow} data-cv-menu><button className={s.iconButton} type="button" aria-expanded={menu === resume.id} aria-controls={`cv-actions-${resume.id}`} aria-label={t('pc.moreActions').replace('{name}', resume.title)} onClick={(event) => { menuButton.current = event.currentTarget; setMenuUp(event.currentTarget.getBoundingClientRect().bottom > window.innerHeight - 310); setMenu(menu === resume.id ? null : resume.id); }}><ProfileIcon kind="more" /></button>
            {menu === resume.id && <div id={`cv-actions-${resume.id}`} className={s.overflowMenu} style={menuUp ? { top: 'auto', bottom: 40 } : undefined}>
              <button type="button" onClick={() => { setMenu(null); setResumeError(''); setResumeEditor(resume); }}><ProfileIcon kind="edit" />{t('pc.editCvDetails')}</button>
              {!resume.isPrimary && resume.hasFile && <button type="button" disabled={Boolean(busy)} onClick={() => void setPrimary(resume)}><ProfileIcon kind="star" />{t('emp.setPrimary')}</button>}
              <button type="button" onClick={() => openFile(resume, 'replace')}><ProfileIcon kind="upload" />{t(resume.hasFile ? 'pc.replaceFile' : 'pc.attachFile')}</button>
              {resume.hasFile && <button type="button" disabled={Boolean(busy)} onClick={() => openFile(resume, 'preview')}><ProfileIcon kind="download" />{t('pc.downloadFile')}</button>}
              <button className={s.deleteAction} type="button" onClick={() => { setMenu(null); setRemoveError(''); setRemoving({ kind: 'resumes', id: resume.id, name: resume.title }); }}><ProfileIcon kind="trash" />{t('pc.remove')}</button>
            </div>}
          </div></div>
        </article>)}
      </div> : <div className={s.libraryEmpty}>
        <div className={s.libraryEmptyCopy}>
          <span className={s.libraryEmptyIcon}><ProfileIcon /></span>
          <p className={s.libraryEmptyEyebrow}>{t('pc.myCvs')}</p>
          <h2>{t('pc.firstCv')}</h2>
          <p>{t('cv.uploadHint')}</p>
          <button type="button" className={s.primary} onClick={() => openImport()}><ProfileIcon kind="plus" />{t('cv.upload')}</button>
        </div>
        <div className={s.cvPreview} aria-hidden="true">
          <div className={s.cvPaper}>
            <div className={s.cvPaperHeader}><span className={s.cvPaperAvatar} /><span className={s.cvPaperIdentity}><i /><i /></span></div>
            <div className={s.cvPaperDivider} />
            <div className={s.cvPaperBlock}><i className={s.cvPaperHeading} /><i /><i className={s.cvPaperLineShort} /></div>
            <div className={s.cvPaperBlock}><i className={s.cvPaperHeading} /><i /><i /><i className={s.cvPaperLineShort} /></div>
            <div className={s.cvPaperBlock}><i className={s.cvPaperHeading} /><span className={s.cvPaperSkills}><i /><i /><i /></span></div>
          </div>
          <span className={s.cvPreviewBadge}><i />CV</span>
        </div>
      </div>}
    </section> : <div className={s.profileContent}>
      <section id="overview" data-profile-section className={s.identity}>
        <div className={s.person}><Link className={s.personAvatar} href="/settings" aria-label={t('pc.manageAccount')}>
          {profile.user.avatarUrl && failedAvatarUrl !== profile.user.avatarUrl
            ? <img src={profile.user.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatarUrl(profile.user.avatarUrl || null)} />
            : profile.user.fullName.charAt(0)}
        </Link><div><h2>{profile.user.fullName}</h2><p>{profile.desiredPositions?.join(', ') || profile.desiredPosition}</p>{(profile.city || profile.residenceCountry) && <div className={s.location}><ProfileIcon kind="pin" />{profile.city?.name || profile.residenceCountry?.name}</div>}<button type="button" className={s.secondary} onClick={() => setEditor({ kind: 'basics' })}><ProfileIcon kind="edit" />{t('pc.editBasics')}</button></div></div>
        <div className={s.completeness}><div><span>{t('workspace.profileComplete')}</span><strong>{completeness?.percent || 0}%</strong></div><progress max={100} value={completeness?.percent || 0} aria-label={t('workspace.profileComplete')} /><p>{completeness?.percent === 100 ? t('cv.completeHint') : completeness?.missing[0] ? t(completeness.missing[0].labelKey) : t('pc.profileHint')}</p></div>
      </section>
      <div className={s.importStrip}><ProfileIcon /><span>{t('cv.noManual')}</span><Link className={s.primary} href={CVS_HREF}>{t('pc.myCvs')}<ProfileIcon kind="arrow" /></Link></div>
      <Section id="preferences" title={t('pc.preferences')} action={editButton('basics')}><dl className={s.facts}><div><dt>{t('emp.desiredPosition')}</dt><dd>{profile.desiredPositions?.join(', ') || profile.desiredPosition || <span className={s.quiet}>{t('pc.notSet')}</span>}</dd></div><div><dt>{onboardingText('salaryTitle')}</dt><dd>{profile.desiredSalaryMin != null ? `${new Intl.NumberFormat(locale).format(Number(profile.desiredSalaryMin))} ${profile.desiredSalaryCurrency || 'UZS'} | ${onboardingText(profile.desiredSalaryPeriod || 'MONTHLY')}${profile.salaryNegotiable ? ' | '+onboardingText('negotiable') : ''}` : <span className={s.quiet}>{t('pc.notSet')}</span>}</dd></div><div><dt>{onboardingText('countries')}</dt><dd>{profile.preferredCountries?.map(c=>countryName(c,locale)).join(', ') || t('pc.notSet')}</dd></div><div><dt>{onboardingText('residence')}</dt><dd>{profile.residenceCountry ? countryName(profile.residenceCountry,locale) : profile.city?.name || t('pc.notSet')}</dd></div></dl></Section>
      <Section id="contact" title={t('pc.contact')} action={<Link className={s.textButton} href="/settings"><ProfileIcon kind="external" />{t('pc.manageAccount')}</Link>}><dl className={s.facts}><div><dt>{t('email')}</dt><dd>{profile.user.email || t('pc.notSet')}{profile.user.emailVerified && <span className={s.badge}><ProfileIcon kind="check" />{t('emailVerifiedBadge')}</span>}</dd>{profile.user.email && !profile.user.emailVerified && <button type="button" className={s.textButton} disabled={Boolean(busy)} onClick={() => void action('verify', async () => { const res = await api<{ message?: string }>('/auth/request-verification', { method: 'POST' }); await refresh(res.message || t('verifyEmailSentTo') + ' ' + profile.user.email); })}>{t('verifyEmailCta')}</button>}</div><div><dt>{t('emp.phone')}</dt><dd>{profile.phone || <span className={s.quiet}>{t('pc.notSet')}</span>}<button type="button" className={s.textButton} disabled={Boolean(busy)} onClick={() => setEditor({ kind: 'phone' })}><ProfileIcon kind="edit" />{onboardingText('phoneEdit')}</button></dd></div></dl></Section>
      <Section id="languages" title={t('languages')} action={editButton('languages')}><div className={s.tags}>{profile.languages.map((row) => <span className={s.tag} key={row.id}>{row.language.name}<small>{enumLabel('cefr', row.level)}</small></span>)}{addButton('languages')}</div></Section>
      <Section id="certifications" title={t('certifications')}><div className={s.timeline}>{profile.certifications.map((row) => <div className={s.timelineItem} key={row.id}><div className={s.entryHeading}><div><strong>{row.name}</strong>{row.issuer && <p>{row.issuer}</p>}<small>{[date(row.issuedAt), row.expiresAt ? `${t('emp.expiresAt')} ${date(row.expiresAt)}` : ''].filter(Boolean).join(' | ')}</small>{row.credentialUrl && /^https?:\/\//i.test(row.credentialUrl) && <p><a className={s.textButton} href={row.credentialUrl} target="_blank" rel="noreferrer">{t('emp.credentialUrl')}<ProfileIcon kind="external" /></a></p>}</div>{entryActions('certification', 'certifications', row.id, row.name)}</div></div>)}</div>{!profile.certifications.length && <p className={s.quiet}>{t('pc.emptySection')}</p>}{addButton('certification')}</Section>
    </div>)}

    {editor && profile && <ProfileForms key={`${editor.kind}:${editor.id || ''}`} editor={editor} profile={profile} onClose={() => setEditor(null)} onSaved={refresh} />}
    {importing && <CvUploadDialog onClose={() => setImporting(null)} onUploaded={() => refresh(t('pc.cvAdded'))} />}
    {removing && <ProfileDialog title={t(removing.kind === 'resumes' ? 'pc.deleteTitle' : 'pc.removeEntry')} onClose={() => setRemoving(null)} busy={busy === 'delete'}><div className={s.dialogBody}><p className={s.muted}>{t(removing.kind === 'resumes' ? 'pc.deleteHint' : 'pc.removeEntryHint')}</p><p><strong>{removing.name}</strong></p>{removeError && <div className={s.error} role="alert">{removeError}</div>}<footer className={s.dialogFooter}><button type="button" className={s.secondary} disabled={Boolean(busy)} onClick={() => setRemoving(null)}>{t('cancel')}</button><button type="button" className={s.dangerButton} disabled={Boolean(busy)} onClick={() => void remove()}>{busy === 'delete' ? t('saving') : t('pc.remove')}</button></footer></div></ProfileDialog>}
    {fileDialog && <ProfileDialog title={fileDialog.kind === 'preview' ? fileDialog.resume.title : t(fileDialog.resume.hasFile ? 'pc.replaceTitle' : 'pc.attachFile')} onClose={() => setFileDialog(null)} busy={busy === 'replace'}>
      {fileDialog.kind === 'preview' ? <div className={s.dialogBody}><div className={s.empty}><ProfileIcon /><h2>{fileDialog.resume.title}</h2>{fileLoading && <p role="status">{t('pc.loadingFile')}</p>}{fileUrl && <a className={s.primary} href={fileUrl} target="_blank" rel="noopener noreferrer">{t('pc.openFile')}<ProfileIcon kind="external" /></a>}</div>{fileError && <div className={s.error} role="alert">{fileError}</div>}<footer className={s.dialogFooter}><button className={s.secondary} type="button" onClick={() => setFileDialog(null)}>{t('pc.done')}</button></footer></div> : <form onSubmit={replaceFile} className={s.form}><p className={s.muted}>{t('pc.replaceHint')}</p><CvFileDrop file={file} disabled={Boolean(busy)} onPick={(file) => { const error = file ? cvFileError(file, t) : null; setFileError(error || ''); setFile(error ? null : file); }} />{fileError && <div className={s.error} role="alert">{fileError}</div>}<footer className={s.dialogFooter}><button className={s.secondary} type="button" disabled={Boolean(busy)} onClick={() => setFileDialog(null)}>{t('cancel')}</button><button className={s.primary} type="submit" disabled={!file || Boolean(busy)}>{busy === 'replace' ? t('saving') : t(fileDialog.resume.hasFile ? 'pc.replaceFile' : 'pc.attachFile')}</button></footer></form>}
    </ProfileDialog>}
    {evidenceReview?.currentVersionId&&<EmployeeEvidenceReview resumeId={evidenceReview.id} versionId={evidenceReview.currentVersionId} onClose={()=>{setEvidenceReview(null);void load();}}/>}
    {resumeEditor && <ProfileDialog title={t('pc.editCvDetails')} onClose={() => setResumeEditor(null)} busy={busy === 'resume-details'} guardChanges><form className={s.form} onSubmit={saveResumeDetails}><FormField label={t('pc.cvName')} required><input name="title" defaultValue={resumeEditor.title} maxLength={160} required /></FormField>{resumeError && <div className={s.error} role="alert">{resumeError}</div>}<footer className={s.dialogFooter}><button className={s.secondary} type="button" disabled={Boolean(busy)} onClick={() => setResumeEditor(null)}>{t('cancel')}</button><button className={s.primary} type="submit" disabled={Boolean(busy)}>{busy ? t('saving') : t('save')}</button></footer></form></ProfileDialog>}
  </div>;
}
