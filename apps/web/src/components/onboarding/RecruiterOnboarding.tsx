'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, AuthSession, saveSession } from '@/lib/api';
import { useRouter } from '@/lib/navigation';
import { accountReturnHref, employerWorkspaceHref } from '@/lib/accountNavigation';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { PackageCode, packagePreference, packageHref, withPackagePreference } from '@/lib/jobCommerce';
import { LocationFields } from '@/components/ui/LocationFields';
import { RecruiterJobEditor } from '@/components/recruiter/RecruiterJobEditor';
import { LinkedInSharePreview } from '@/components/recruiter/LinkedInSharePreview';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import s from '@/components/recruiter/JobCommerce.module.css';

type CompanyDraft = {name: string; description: string; website: string; countryId: string; citySlug: string; industrySlug: string; size: string};
type Progress = {status: string; step: number; companyId: string|null; jobId: string|null; companyDraft: CompanyDraft|null; preferredPackage?: PackageCode|null; memberships: any[]};
function draft(company: any): CompanyDraft {return {name: company?.name || '', description: company?.description || '', website: company?.website || '', countryId: company?.city?.province?.country?.id || '', citySlug: company?.city?.slug || '', industrySlug: company?.industry?.slug || '', size: company?.size || ''};}
export function RecruiterOnboarding() {
  const {t, locale} = useI18n(), enumLabel = useEnumLabel(), router = useRouter(), params = useSearchParams();
  const [progress, setProgress] = useState<Progress|null>(null), [companyId, setCompanyId] = useState(''), [values, setValues] = useState<CompanyDraft>(draft(null));
  const [meta, setMeta] = useState<any>(null), [industries, setIndustries] = useState<any[]>([]), [job, setJob] = useState<any>(null), [benefit, setBenefit] = useState<any>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [editor, setEditor] = useState(false), [retry, setRetry] = useState(0), [loaded, setLoaded] = useState(false), [saved, setSaved] = useState(false);
  const [linkedinApproval, setLinkedinApproval] = useState<string|null>(null), [linkedinIntent, setLinkedinIntent] = useState(false);
  const autosave = useRef<ReturnType<typeof setTimeout>|null>(null), queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastDraft = useRef(''), alive = useRef(true);
  const membership = progress?.memberships.find(row => row.companyId === companyId), company = membership?.company;
  const canManage = ['OWNER', 'ADMIN'].includes(membership?.role);
  const preferredPackage = packagePreference(params.toString()) || progress?.preferredPackage || undefined;
  const returnTo = withPackagePreference(accountReturnHref('RECRUITER', params.get('next')) || employerWorkspaceHref('jobs', companyId), preferredPackage);
  useEffect(() => {alive.current = true; return () => {alive.current = false; if (autosave.current) clearTimeout(autosave.current);};}, []);
  useEffect(() => {
    const abort = new AbortController(); setError(''); setLoaded(false);
    (async () => {
      const [state, groups, cities, skills, categories, benefits, languages] = await Promise.all([
        api<Progress>('/recruiter-onboarding', {signal: abort.signal}),
        api<any>('/meta/industries?group=1', {auth: false, signal: abort.signal}),
        ...['cities', 'skills?sort=popular&take=120', 'categories', 'benefits', 'languages'].map(path => api<any[]>('/meta/' + path, {auth: false, signal: abort.signal})),
      ]);
      if (abort.signal.aborted) return;
      if (state.status !== 'IN_PROGRESS') {router.replace(accountReturnHref('RECRUITER', params.get('next')) || '/dashboard/recruiter?tab=jobs'); return;}
      const chosen = state.memberships.find(row => row.companyId === state.companyId) || state.memberships[0];
      if (!chosen) throw new Error(t('rw.noCompanyHint'));
      const preference = packagePreference(params.toString());
      if (preference && preference !== state.preferredPackage) {
        await api('/recruiter-onboarding', {method: 'PATCH', body: JSON.stringify({companyId: chosen.companyId, step: state.step, preferredPackage: preference})});
        state.preferredPackage = preference;
      }
      if (abort.signal.aborted) return;
      const initial = state.companyId === chosen.companyId && state.companyDraft ? state.companyDraft : draft(chosen.company);
      setProgress(state); setCompanyId(chosen.companyId); setValues(initial); lastDraft.current = JSON.stringify([chosen.companyId, initial]);
      setIndustries(Array.isArray(groups) ? groups : groups.groups || []); setMeta({cities, skills, categories, benefits, languages});
      if (state.jobId) {
        const [storedJob, storedBenefit] = await Promise.all([api<any>('/jobs/' + state.jobId, {signal: abort.signal}), api<any>('/benefits/jobs/' + state.jobId, {signal: abort.signal})]);
        if (!abort.signal.aborted) {
          setJob(storedJob); setBenefit(storedBenefit);
          if (storedBenefit.selected && state.step === 2) {
            await api('/recruiter-onboarding', {method: 'PATCH', body: JSON.stringify({companyId: chosen.companyId, jobId: state.jobId, step: 3})});
            if (!abort.signal.aborted) setProgress(previous => previous ? {...previous, step: 3} : previous);
          }
        }
      }
      if (!abort.signal.aborted) setLoaded(true);
    })().catch(e => {if (!abort.signal.aborted) setError(e.message);});
    return () => abort.abort();
  }, [locale, retry]);
  function enqueue(input: Record<string, unknown>) {
    const run = queue.current.catch(() => undefined).then(() => api('/recruiter-onboarding', {method: 'PATCH', body: JSON.stringify(input)}));
    queue.current = run;
    return run;
  }
  useEffect(() => {
    if (!loaded || progress?.step !== 1 || !canManage) return;
    function context(event: Event) {
      const request = event as CustomEvent<{guards: Promise<boolean>[]}>, serialized = JSON.stringify([companyId, values]);
      if (busy) {request.detail.guards.push(Promise.resolve(false)); return;}
      if (serialized === lastDraft.current) return;
      if (autosave.current) clearTimeout(autosave.current);
      request.detail.guards.push(enqueue({companyId, step: 1, companyDraft: values}).then(() => {
        lastDraft.current = serialized; return true;
      }, reason => {setError(reason.message); return false;}));
    }
    document.addEventListener('talentio:employer-context', context);
    return () => document.removeEventListener('talentio:employer-context', context);
  }, [loaded, progress?.step, canManage, busy, companyId, values]);
  useEffect(() => {
    if (!loaded || !progress || progress.step !== 1 || !companyId || !canManage) return;
    const serialized = JSON.stringify([companyId, values]);
    if (serialized === lastDraft.current) return;
    setSaved(false);
    autosave.current = setTimeout(() => {
      void enqueue({companyId, step: 1, companyDraft: values}).then(() => {if (alive.current) {lastDraft.current = serialized; setSaved(true);}}).catch(e => {if (alive.current) setError(e.message);});
    }, 700);
    return () => {if (autosave.current) clearTimeout(autosave.current);};
  }, [values, companyId, loaded, canManage, progress?.step]);
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('');
    if (autosave.current) clearTimeout(autosave.current);
    try {await queue.current; await action();} catch (e) {setError(e instanceof Error ? e.message : String(e));} finally {if (alive.current) setBusy(false);}
  }
  async function finish(skipJob: boolean) {
    await api('/recruiter-onboarding/complete', {method: 'POST', body: JSON.stringify({skipJob})});
    saveSession(await api<AuthSession>('/auth/me'));
    router.replace(returnTo);
  }
  async function saveCompany(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (canManage) await api('/companies/' + companyId, {method: 'PATCH', body: JSON.stringify({...values, locale})});
      await enqueue({companyId, step: 2, companyDraft: values});
      setProgress(previous => previous ? {...previous, step: 2, companyId} : previous);
    });
  }
  async function rememberJob(id: string) {await enqueue({companyId, step: 2, jobId: id});}
  async function choosePackage(id: string) {
    await enqueue({companyId, step: 3, jobId: id});
    router.push(packageHref(id, '/onboarding/recruiter?next=' + encodeURIComponent(returnTo), preferredPackage));
  }
  const change = (key: keyof CompanyDraft, value: string) => setValues(previous => ({...previous, [key]: value}));
  if (!loaded || !progress || !meta) return <div className={s.page}>{error ? <div role="alert" className={s.error}>{error}<br/><button className={s.text} onClick={() => setRetry(n => n + 1)}>{t('workspace.retry')}</button></div> : <WorkspaceLoading/>}</div>;
  if (editor) return <RecruiterJobEditor companyId={companyId} company={company} job={job} meta={meta} initialStep={job && progress.step === 3 ? 3 : 0}
    onClose={() => {setEditor(false); setRetry(n => n + 1);}} onSaved={async () => {}} onDraftSaved={rememberJob} onChoosePackage={choosePackage}
    onPublished={() => void run(() => finish(false))}/>;
  return <div className={s.page}><div className={s.onboarding}>
    <div className={s.progress}><span>{t('commerce.step').replace('{n}', String(progress.step))}</span><div className={s.segments} aria-hidden="true">{[1,2,3].map(step => <i key={step} data-active={step <= progress.step}/>)}</div></div>
    <header className={s.headline}><span className={s.stepIcon}><WorkspaceIcon kind={progress.step === 1 ? 'building' : 'briefcase'}/></span><h1>{t('commerce.' + (progress.step === 1 ? 'companyStep' : progress.step === 2 ? 'firstJob' : 'ready'))}</h1><p>{t('commerce.' + (progress.step === 1 ? 'companyHint' : progress.step === 2 ? 'firstJobHint' : 'successHint'))}</p></header>
    {error && <div className={s.error} role="alert">{error.startsWith('COMPANY_PROFILE_REQUIRED') ? t('commerce.companyRequired') : error}</div>}
    {progress.step === 1 ? <form className={s.form} onSubmit={event => void saveCompany(event)}>
      {progress.memberships.length > 1 && <label>{t('companyName')}<select value={companyId} disabled={busy} onChange={event => {const selected = progress.memberships.find(row => row.companyId === event.target.value); setCompanyId(event.target.value); setValues(draft(selected.company));}}>{progress.memberships.map(row => <option value={row.companyId} key={row.companyId}>{row.company.name}</option>)}</select></label>}
      {!canManage && <div className={s.notice}>{t(company?.description?.trim().length >= 20 && company?.industry && company?.city && company?.size ? 'commerce.companyMemberHint' : 'commerce.contactOwner')}</div>}
      <fieldset disabled={busy || !canManage} className={s.form} style={{border: 0, margin: 0, padding: 0}}>
        <label>{t('companyName')} *<input value={values.name} required minLength={2} maxLength={160} onChange={event => change('name', event.target.value)}/></label>
        <label>{t('rec.description')} *<textarea value={values.description} required minLength={20} maxLength={5000} onChange={event => change('description', event.target.value)}/></label>
        <div className={s.columns}><label>{t('trustItemIndustry')} *<select value={values.industrySlug} required onChange={event => change('industrySlug', event.target.value)}><option value="">-</option>{industries.map(group => group.industries ? <optgroup key={group.slug} label={group.name}>{group.industries.map((item: any) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</optgroup> : <option key={group.slug} value={group.slug}>{group.name}</option>)}</select></label>
          <label>{t('trustItemSize')} *<select value={values.size} required onChange={event => change('size', event.target.value)}><option value="">-</option>{['SIZE_1_10','SIZE_11_50','SIZE_51_200','SIZE_201_1000','SIZE_1000_PLUS'].map(size => <option key={size} value={size}>{({'SIZE_1_10':'1-10','SIZE_11_50':'11-50','SIZE_51_200':'51-200','SIZE_201_1000':'201-1,000','SIZE_1000_PLUS':'1,000+'} as Record<string,string>)[size]}</option>)}</select></label></div>
        <LocationFields countryId={values.countryId} citySlug={values.citySlug} initialCity={company?.city} required cityRequired onChange={next => setValues(previous => ({...previous, countryId: next.countryId, citySlug: next.citySlug}))}/>
        <label>{t('trustItemWebsite')}<input type="url" value={values.website} maxLength={500} onChange={event => change('website', event.target.value)} placeholder="https://"/></label>
      </fieldset>
      <div className={s.actions}><span className={s.muted} style={{fontSize: '.78rem'}} aria-live="polite">{saved && t('commerce.saved')}</span><button className={s.primary} disabled={busy}>{t(busy ? 'saving' : 'commerce.continue')} →</button></div>
    </form> : <>
      <div className={s.jobPrompt}><span className={s.stepIcon}><WorkspaceIcon kind="briefcase"/></span><h2>{job?.title || t('commerce.firstJob')}</h2><p>{company?.name}</p>
        {benefit?.selected && <p><span className={s.status}>{t('commerce.' + benefit.code)}</span> | {t('commerce.selected')}</p>}
        <button className={s.primary} disabled={busy} onClick={() => {setEditor(true);}}>{t(job ? 'rec.edit' : 'commerce.startJob')} →</button>
        {job && !benefit?.selected && <div><button className={s.text} disabled={busy} onClick={() => void run(() => choosePackage(job.id))}>{t('commerce.choose')} →</button></div>}
      </div>
      {progress.step === 3 && job && benefit?.code === 'PREMIUM' && <LinkedInSharePreview jobId={job.id} title={job.title} companyName={company?.name || ''} isAnonymous={Boolean(job.isAnonymous)} employmentType={job.employmentType} workMode={job.workMode} published={job.status === 'PUBLISHED'} onApprovalChange={setLinkedinApproval} onShareIntentChange={setLinkedinIntent}/>}
      <div className={s.actions}><button className={s.secondary} disabled={busy} onClick={() => void run(async () => {await enqueue({companyId, step: 1}); setProgress(previous => previous ? {...previous, step: 1} : previous);})}>← {t('commerce.back')}</button>
        {progress.step === 3 && benefit?.selected && <button className={s.primary} disabled={busy || (linkedinIntent && !linkedinApproval)} onClick={() => void run(async () => {
          if (linkedinIntent && !linkedinApproval) throw new Error(t('li.previewRequired'));
          await api('/jobs/' + job.id + '/status', {method: 'POST', body: JSON.stringify({status: 'PUBLISHED', ...(linkedinApproval ? {linkedinPreviewId: linkedinApproval} : {})})});
          await finish(false);
        })}>{t('commerce.publish')} →</button>}</div>
      <div style={{textAlign: 'center', marginTop: 18}}><button className={s.text} disabled={busy} onClick={() => void run(() => finish(true))}>{t('commerce.later')}</button></div>
    </>}
  </div></div>;
}
