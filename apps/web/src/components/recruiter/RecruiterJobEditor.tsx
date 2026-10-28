'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { FormField, LabelText } from '@/components/ui/Field';
import { JobTitleInput } from '@/components/ui/JobTitleInput';
import { LocationFields } from '@/components/ui/LocationFields';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { CompanyMark } from '@/components/employee/WorkspacePrimitives';
import { ScreeningQuestionsEditor, screeningDraftsFromJob, type ScreeningQuestionDraft } from './ScreeningQuestionsEditor';
import { JobLanguageVersions } from './JobLanguageVersions';
import { LinkedInSharePreview } from './LinkedInSharePreview';
import { localeUrl } from '@/lib/navigation';
import { employerJobHref } from '@/lib/accountNavigation';
import { PackageCode, packagePreference, packageHref } from '@/lib/jobCommerce';
import s from './RecruiterWorkspace.module.css';
import e from './RecruiterJobEditor.module.css';
import { useEmployerUnsaved } from './useEmployerUnsaved';

type Pick = { slug: string; name: string; isRequired?: boolean; weight?: number; minLevel?: string | null };
type JobLanguage = { code: string; name: string; minLevel: string; isRequired: boolean; confirmed?: boolean };
type Props = { companyId: string; company: any; job: any | null; meta: any; initialStep?: number; onClose: () => void; onPublished?: (id:string) => void; onDraftSaved?: (id:string) => Promise<void>; onChoosePackage?: (id:string) => Promise<void>; onSaved: (message: string) => Promise<void> };

export function RecruiterJobEditor({ companyId, company, job, meta, initialStep = 0, onClose, onPublished, onDraftSaved, onChoosePackage, onSaved }: Props) {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const confirm = useConfirm();
  const [step, setStep] = useState(initialStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useRef(false);
  const currencyEdited = useRef(false);
  const [savedJob, setSavedJob] = useState(job);
  const [packageSelected, setPackageSelected] = useState(false);
  const [linkedinApproval,setLinkedinApproval]=useState<string|null>(null);
  const [linkedinIntent,setLinkedinIntent]=useState(false);
  const [values, setValues] = useState({ title: job?.title || '', description: job?.description || '', citySlug: job?.city?.slug || '', countryId: job?.countryId || job?.country?.id || job?.city?.province?.country?.id || (job?.workMode === 'REMOTE' && !job?.city ? '__WORLDWIDE__' : ''), categorySlug: job?.category?.slug || '', experienceLevel: job?.experienceLevel || '', experienceYearsMin: job?.experienceYearsMin == null ? '' : String(job.experienceYearsMin), salaryMin: job?.salaryMin == null ? '' : String(job.salaryMin), salaryMax: job?.salaryMax == null ? '' : String(job.salaryMax), salaryPeriod: job?.salaryPeriod || 'MONTHLY', currency: job?.currency || 'UZS', employmentType: job?.employmentType || 'FULL_TIME', workMode: job?.workMode || 'ONSITE', locale: job?.locale || locale, isAnonymous: Boolean(job?.isAnonymous) });
  const [skills, setSkills] = useState<Pick[]>((job?.jobSkills || job?.skills || []).map((item: any) => ({ slug: item.skill?.slug || item.slug || '', name: item.skill?.name || item.name, isRequired: item.isRequired !== false, weight: item.weight ?? 1, minLevel:item.minLevel ?? null })));
  const [skillDraft, setSkillDraft] = useState('');
  const [benefits, setBenefits] = useState<Pick[]>((job?.benefits || []).map((item: any) => ({ slug: item.benefit?.slug || item.slug || '', name: item.benefit?.name || item.name })));
  const [languages, setLanguages] = useState<JobLanguage[]>((job?.jobLanguages || []).map((item: any) => ({ code: item.language?.code, name: item.language?.name, minLevel: item.minLevel || 'B1', isRequired: item.isRequired !== false, confirmed:item.provenance === 'EMPLOYER_CONFIRMED' })).filter((item: JobLanguage) => item.code));
  const [questions, setQuestions] = useState<ScreeningQuestionDraft[]>(screeningDraftsFromJob(job || {}));
  const lastSaved = useRef('');
  const [translationOpen, setTranslationOpen] = useState(false);
  const state = JSON.stringify({ values, skills, benefits, languages, questions });
  if (!lastSaved.current) lastSaved.current = state;
  const dirty = state !== lastSaved.current;
  const allowSavedNavigation=useEmployerUnsaved(dirty, busy);
  function showError(message: string) {
    setError(message);
    requestAnimationFrame(() => {
      const alert = errorRef.current;
      if (!alert) return;
      alert.scrollIntoView({ block: 'center', behavior: 'smooth' });
      alert.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    setPackageSelected(false);
    if (step !== 3 || !savedJob?.id) return;
    const abort = new AbortController();
    api<{selected: boolean}>('/benefits/jobs/' + savedJob.id, {signal: abort.signal})
      .then(value => {if (!abort.signal.aborted) setPackageSelected(value.selected);})
      .catch(reason => {if (!abort.signal.aborted) showError(reason.message);});
    return () => abort.abort();
  }, [step, savedJob?.id]);
  const update = (key: keyof typeof values, value: string | boolean) => {
    if (key === 'currency') currencyEdited.current = true;
    setValues((previous) => ({ ...previous, [key]: value, ...(key === 'workMode' && value !== 'REMOTE' && previous.countryId === '__WORLDWIDE__' ? { countryId: '', citySlug: '' } : {}) }));
    setFieldErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };
  const addSkill = () => {
    const name = skillDraft.trim().replace(/\s+/g, ' ');
    if (!name) return;
    setSkills((current) => {
      if (current.length >= 30 || current.some((skill) => skill.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) return current;
      return [...current, { slug: '', name, isRequired: true, weight: 1 }];
    });
    setSkillDraft('');
  };
  useEffect(() => {
    if (!focusInvalid.current) return;
    const frame = requestAnimationFrame(() => {
      focusInvalid.current = false;
      const control = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      control?.focus({ preventScroll: true });
      (control || formRef.current)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [fieldErrors, step]);
  async function close() {
    if (busy) return;
    if (dirty && !await confirm({ title: t('rw.discard'), message: t('rw.discardHint'), confirmLabel: t('discardChanges'), cancelLabel: t('rw.keepEditing'), tone: 'danger' })) return;
    onClose();
  }
  function valid(target = 3, publish = false) {
    const errors: Record<string, string> = {};
    if (values.title.trim().length < 3) errors.title = t('rw.titleError');
    if (values.description.trim().length < 20) errors.description = t('rw.descriptionError');
    if (!values.countryId || (values.countryId === '__WORLDWIDE__' && values.workMode !== 'REMOTE')) errors.countryId = t('geo.countryRequired');
    if (values.currency.trim().length !== 3) errors.currency = t('rw.currencyError');
    if (publish && values.workMode !== 'REMOTE' && !values.citySlug) errors.citySlug = t('rw.cityError');
    for (const key of ['salaryMin', 'salaryMax'] as const) {
      if (values[key] !== '' && (!Number.isSafeInteger(Number(values[key])) || Number(values[key]) < 0)) errors[key] = t('rw.salaryNumberError');
    }
    if (!errors.salaryMin && !errors.salaryMax && values.salaryMin !== '' && values.salaryMax !== '' && Number(values.salaryMax) < Number(values.salaryMin)) errors.salaryMax = t('rw.salaryRange');
    if (values.experienceYearsMin !== '' && (!Number.isInteger(Number(values.experienceYearsMin)) || Number(values.experienceYearsMin) < 0 || Number(values.experienceYearsMin) > 50)) errors.experienceYearsMin = t('rw.experienceError');
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError('');
      setStep(Object.keys(errors).some((key) => key !== 'experienceYearsMin') ? 0 : 1);
      focusInvalid.current = true;
      return false;
    }
    if (target >= 3 && questions.some((question) => question.question.trim().length < 3)) { setStep(2); showError(t('rw.requiredFields')); return false; }
    setError(''); return true;
  }
  function goTo(target: number) {
    if (target < step || valid(target)) {
      setStep(target);
      formRef.current?.closest('[data-job-editor]')?.scrollIntoView({ block: 'start' });
    }
  }
  async function removeQuestion(question: ScreeningQuestionDraft) {
    return !question.answerCount || await confirm({ title: t('rec.screeningDeleteConfirm'), message: t('rec.screeningDeleteConfirmBody').replace('{n}', String(question.answerCount)), confirmLabel: t('rec.screeningRemove'), tone: 'danger' });
  }
  async function save(publish = false):Promise<string|null> {
    if (busy || !valid(3, publish)) return null;
    if(publish && linkedinIntent && !linkedinApproval){setStep(3);showError(t('li.previewRequired'));return null;}
    setBusy(true); setError('');
    let result = savedJob;
    try {
      const payload = { ...values, expectedUpdatedAt: savedJob?.updatedAt, screeningQuestions: questions.map((question, sortOrder) => ({ id: question.id, question: question.question.trim(), type: question.type, isRequired: question.isRequired, sortOrder })), currency: values.currency.toUpperCase(), title: values.title.trim(), description: values.description.trim(), citySlug: values.citySlug, countryId: values.countryId === '__WORLDWIDE__' ? null : values.countryId || null, categorySlug: values.categorySlug || undefined, experienceLevel: values.experienceLevel || null, experienceYearsMin: values.experienceYearsMin === '' ? null : Number(values.experienceYearsMin), salaryMin: values.salaryMin === '' ? null : Number(values.salaryMin), salaryMax: values.salaryMax === '' ? null : Number(values.salaryMax), skills: skills.map((skill) => ({ ...(skill.slug ? { slug: skill.slug } : { name: skill.name }), isRequired: skill.isRequired !== false, weight: skill.weight ?? 1, minLevel:skill.minLevel ?? null })), benefits: benefits.map((benefit) => benefit.slug ? { slug: benefit.slug } : { name: benefit.name }), languages };
      result = await api<any>(savedJob?.id ? '/jobs/' + savedJob.id : '/jobs/company/' + companyId, { method: savedJob?.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      // Persist the ID immediately so retrying a later question request never creates another job.
      result = { ...result, id: result?.id || savedJob?.id };
      setSavedJob(result);
      const next = screeningDraftsFromJob(result).map(question => ({ ...question, answerCount: questions.find(old => old.id === question.id)?.answerCount ?? question.answerCount }));
      setQuestions(next);
      lastSaved.current = JSON.stringify({ values, skills, benefits, languages, questions: next });
      if (onDraftSaved) await onDraftSaved(result.id);
      if (publish) {
        const benefit = await api<{selected: boolean; packagesEnabled?: boolean}>('/benefits/jobs/' + result.id);
        if (benefit.packagesEnabled === false) throw new Error(t('commerce.packagesUnavailable'));
        setPackageSelected(benefit.selected);
        if (!benefit.selected) {
          allowSavedNavigation();
          if (onChoosePackage) await onChoosePackage(result.id);
          else {
            const preferred = packagePreference(window.location.search) || (getSession()?.user.role === 'RECRUITER'
              ? (await api<{preferredPackage?: PackageCode|null}>('/recruiter-onboarding')).preferredPackage || undefined : undefined);
            window.location.assign(localeUrl(locale, packageHref(result.id, undefined, preferred)));
          }
          return result.id;
        }
        if (!await confirm({ title: t('rw.publishConfirm'), message: t('rw.publishHint')+(linkedinApproval?' '+t('li.shareConfirmHint'):''), confirmLabel: t('rec.publish') })) return result.id;
      }
      if (publish) await api('/jobs/' + result.id + '/status', { method: 'POST', body: JSON.stringify({ status: 'PUBLISHED', ...(linkedinApproval?{linkedinPreviewId:linkedinApproval}:{}) }) });
      await onSaved(t(publish ? 'rec.jobPublished' : savedJob ? 'rec.jobUpdated' : 'rec.jobCreatedDraft'));
      if (publish) { if (onPublished) onPublished(result.id); else onClose(); }
      return result.id;
    } catch (reason) { showError(reason instanceof Error ? reason.message : t('rec.jobUpdateFailed')); return null; }
    finally { setBusy(false); }
  }
  const steps = ['rw.details', 'rw.requirements', 'rw.screening', 'rw.review'];
  const [locationLabel,setLocationLabel] = useState('');
  const shareLocation = values.countryId==='__WORLDWIDE__'?t('geo.worldwide'):locationLabel || (meta.cities || []).find((city: any) => city.slug === values.citySlug)?.name || (values.countryId===(job?.countryId || job?.country?.id)?job?.country?.name:'') || '';
  const shareDraftKey=JSON.stringify([values.title,values.countryId,values.citySlug,values.employmentType,values.workMode,values.salaryMin,values.salaryMax,values.currency,values.salaryPeriod,values.isAnonymous,company?.name,locale]);
  async function openLinkedInSettings(){const id=await save(false);if(!id)return;allowSavedNavigation();const returnTo=employerJobHref(id,'details',companyId)+'&review=1';window.location.assign(localeUrl(locale,'/settings?returnTo='+encodeURIComponent(returnTo)+'#integrations'));}
  const field = (key: keyof typeof values, label: string, options?: { required?: boolean; type?: string; min?: number; max?: number; minLength?: number; maxLength?: number }) => <FormField className={e.field} label={label} optional={false} required={options?.required} error={fieldErrors[key]}><input name={key} value={String(values[key])} type={options?.type || 'text'} min={options?.min} max={options?.max} minLength={options?.minLength} maxLength={options?.maxLength} required={options?.required} onChange={(event) => update(key, event.target.value)} /></FormField>;
  const select = (key: keyof typeof values, label: string, options: { value: string; label: string }[]) => <FormField className={e.field} label={label} optional={false} error={fieldErrors[key]}><select name={key} value={String(values[key])} onChange={(event) => update(key, event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FormField>;
  return <div className={e.editor} data-job-editor>
    <header className={e.toolbar}>
      <div className={e.toolbarInner}>
        <div className={e.identity}>
          <button className={`${s.textButton} ${e.back}`} type="button" disabled={busy} aria-label={t('rw.backJobs')} onClick={() => void close()}><WorkspaceIcon kind="left" /><span>{t('rw.backJobs')}</span></button>
        <div className={e.heading}><h1>{t(savedJob ? 'rw.editJob' : 'rec.createJob')}</h1><span className={s.status} data-status={savedJob?.status || 'DRAFT'}>{enumLabel('jobStatus', savedJob?.status || 'DRAFT')}</span></div>
        </div>
        <nav className={e.steps} aria-label={t('rec.createJob')}><ol>{steps.map((label, index) => <li key={label} data-active={step === index} data-completed={step > index}><button type="button" disabled={busy} aria-label={`${index + 1} ${t(label)}`} aria-current={step === index ? 'step' : undefined} onClick={() => goTo(index)}><span className={e.stepNumber} aria-hidden="true">{step > index ? <WorkspaceIcon kind="check" /> : index + 1}</span><span className={e.stepLabel}>{t(label)}</span></button></li>)}</ol></nav>
        <div className={e.company}><CompanyMark name={company?.name || ''} logo={company?.logoUrl} /><strong>{company?.name}</strong></div>
      </div>
    </header>
    <div className={e.content}>
    {error && <div ref={errorRef} className={e.alert} role="alert" tabIndex={-1}>{error}</div>}{notice && <div className={e.alert} data-tone="success" role="status">{notice}</div>}
      <div className={e.formPanel}>
        <div className={e.panelHeader}><div><h2>{t(steps[step])}</h2><p>{t(['rw.detailsHint', 'rw.requirementsHint', 'rw.screeningOptional', 'rw.reviewHint'][step])}</p></div></div>
        <form ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); if (step < 3) goTo(step + 1); else void save(false); }}><fieldset disabled={busy} className={e.fieldset}>
      {step === 0 && <div className={e.details}>
        <FormField className={e.field} label={t('jobTitleFilter')} required hint={t('rw.titleHint')} error={fieldErrors.title}><JobTitleInput name="title" focusSuggestions value={values.title} onValueChange={(title: string) => update('title', title)} required minLength={3} placeholder={t('rec.jobTitlePlaceholder')} /></FormField>
        <FormField className={e.field} label={t('rec.description')} required error={fieldErrors.description}><textarea name="description" rows={4} maxLength={20000} value={values.description} onChange={(event) => update('description', event.target.value)} minLength={20} required /></FormField>
        <section className={e.group} aria-labelledby="job-editor-location"><h3 id="job-editor-location">{t('rw.locationEmployment')}</h3>
          <LocationFields countryId={values.countryId} citySlug={values.citySlug} initialCity={job?.city} required cityRequired={values.workMode !== 'REMOTE'} allowGlobal={values.workMode === 'REMOTE'} countryError={fieldErrors.countryId} cityError={fieldErrors.citySlug} onChange={(location) => { setLocationLabel(location.label || ''); setValues(previous => ({ ...previous, countryId: location.countryId, citySlug: location.citySlug, ...(!savedJob && !currencyEdited.current && !previous.salaryMin && !previous.salaryMax && location.currencyCode ? { currency: location.currencyCode } : {}) })); setFieldErrors(previous => ({ ...previous, countryId: '', citySlug: '' })); }} />
          <div className={e.fieldRow}>{select('workMode', t('workMode'), ['ONSITE', 'HYBRID', 'REMOTE'].map((value) => ({ value, label: enumLabel('workMode', value) })))}</div>
          <div className={e.fieldRow}>{select('employmentType', t('employmentType'), ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'].map((value) => ({ value, label: enumLabel('employmentType', value) })))}{select('locale', t('rw.postingLanguage'), [{ value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }, { value: 'uz', label: "O‘zbekcha" }, { value: 'id', label: 'Indonesia' }])}</div>
        </section>
        <section className={e.group} aria-labelledby="job-editor-salary"><h3 id="job-editor-salary">{t('workspace.salary')}<span>{t('optional')}</span></h3>
          <div className={e.fieldRow}>{field('salaryMin', t('rw.minimum'), { type: 'number', min: 0 })}{field('salaryMax', t('rw.maximum'), { type: 'number', min: 0 })}</div>
          <div className={e.fieldRow}>{field('currency', t('rec.currency'), { maxLength: 3, minLength: 3 })}{select('salaryPeriod', t('rw.payPeriod'), ['MONTHLY', 'YEARLY', 'HOURLY'].map((value) => ({ value, label: t(value === 'MONTHLY' ? 'rec.periodMonthly' : value === 'YEARLY' ? 'rec.periodYearly' : 'rec.periodHourly') })))}</div>
        </section>
      </div>}
      {step === 1 && <div className={s.fields}>
        <div className={s.fieldRow}>{select('categorySlug', t('category'), [{ value: '', label: '-' }, ...(meta.categories || []).map((category: any) => ({ value: category.slug, label: category.name }))])}{select('experienceLevel', t('experienceLevel'), [{ value: '', label: '-' }, ...['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'].map((value) => ({ value, label: enumLabel('experienceLevel', value) }))])}</div>
        {field('experienceYearsMin', t('rec.minYears'), { type: 'number', min: 0, max: 50 })}
        <div className={e.field}>
          <label htmlFor="job-editor-skill-input"><LabelText>{t('skills')}</LabelText></label>
          <div className={s.tags}>{skills.map((skill, index) => <span className={s.tag} key={skill.slug || skill.name}>{skill.name}<label><input type="checkbox" checked={skill.isRequired !== false} onChange={event=>setSkills(items=>items.map((item,i)=>i===index?{...item,isRequired:event.target.checked}:item))}/>{t('required')}</label><select aria-label={t('job.minimumSkillLevel')+' '+skill.name} value={skill.minLevel ?? ''} onChange={event=>setSkills(items=>items.map((item,i)=>i===index?{...item,minLevel:event.target.value || null}:item))}><option value="">{t('job.anySkillLevel')}</option>{['BEGINNER','INTERMEDIATE','ADVANCED','EXPERT'].map(level=><option key={level} value={level}>{enumLabel('skillLevel',level)}</option>)}</select><button type="button" aria-label={t('rec.remove') + ' ' + skill.name} onClick={() => setSkills((items) => items.filter((_, i) => index !== i))}>×</button></span>)}</div>
          <div className={e.skillInputRow}>
            <input id="job-editor-skill-input" type="text" value={skillDraft} maxLength={79} placeholder={t('rec.skillFreeTextPlaceholder')} onChange={(event) => setSkillDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSkill(); } }} />
            <button className={s.secondary} type="button" disabled={!skillDraft.trim() || skills.length >= 30} onClick={addSkill}>{t('addSkill')}</button>
          </div>
          <span className="field-hint">{t('rec.skillFreeTextHint')}</span>
        </div>
        <div><LabelText>{t('benefits')}</LabelText><div className={s.tags}>{benefits.map((benefit, index) => <span className={s.tag} key={benefit.slug || benefit.name}>{benefit.name}<button type="button" aria-label={t('rec.remove') + ' ' + benefit.name} onClick={() => setBenefits((items) => items.filter((_, i) => index !== i))}>×</button></span>)}</div><LookupCombobox kind="benefits" focusSuggestions placeholder={t('benefitSearchPlaceholder')} allowCreate submitLabel={t('addBenefit')} onPick={(item) => { if (benefits.length < 20 && !benefits.some((existing) => (existing.slug || existing.name) === (item.slug || item.name))) setBenefits([...benefits, item]); }} /></div>
        <div><LabelText>{t('languages')}</LabelText>{languages.map((language, index) => <div className={s.fieldRow} style={{ alignItems: 'center', marginTop: 12 }} key={language.code}><span>{language.name}</span>{language.confirmed === false && <label><input type="checkbox" checked={false} onChange={()=>setLanguages(items=>items.map((item,i)=>i===index?{...item,confirmed:true}:item))}/>{t('job.confirmLanguageRequirement')}</label>}<div className={s.actions}><select aria-label={language.name + ' ' + t('languageLevel')} value={language.minLevel} onChange={(event) => setLanguages((items) => items.map((item, i) => i === index ? { ...item, minLevel: event.target.value } : item))}>{['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'].map((level) => <option key={level}>{level}</option>)}</select><label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={language.isRequired} onChange={(event) => setLanguages((items) => items.map((item, i) => i === index ? { ...item, isRequired: event.target.checked } : item))} />{t('required')}</label><button type="button" className={s.icon} aria-label={t('rec.remove') + ' ' + language.name} onClick={() => setLanguages((items) => items.filter((_, i) => index !== i))}>×</button></div></div>)}{languages.length < 4 && <LookupCombobox kind="languages" focusSuggestions placeholder={t('languageSearchPlaceholder')} allowCreate={false} submitLabel={t('addLanguage')} onPick={(item) => { const code = item.code || item.slug; if (code && !languages.some((language) => language.code === code)) setLanguages([...languages, { code, name: item.name, minLevel: 'B1', isRequired: true }]); }} />}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}><input type="checkbox" checked={values.isAnonymous} onChange={(event) => update('isAnonymous', event.target.checked)} />{t('rec.anonymousPosting')}</label><span className={s.emptyNote}>{t('rec.anonymousPostingHint')}</span>
      </div>}
      {step === 2 && <ScreeningQuestionsEditor idPrefix="recruiter-job" value={questions} onChange={setQuestions} onRemoveSaved={removeQuestion} />}
      {step === 3 && <div className={s.review}>{!packageSelected && savedJob?.status !== 'PUBLISHED' && <p className={s.muted}>{t('commerce.packageBeforePublish')}</p>}<section><h3>{t('rw.details')}<button type="button" className={s.textButton} style={{ float: 'right' }} onClick={() => setStep(0)}>{t('rec.edit')}</button></h3><strong>{values.title}</strong><p>{values.description}</p><p>{values.countryId === '__WORLDWIDE__' ? t('geo.worldwide') : shareLocation || job?.country?.name || ''}</p><div className={s.tags}><span className={s.tag}>{enumLabel('workMode', values.workMode)}</span><span className={s.tag}>{enumLabel('employmentType', values.employmentType)}</span></div></section><section><h3>{t('rw.requirements')}<button type="button" className={s.textButton} style={{ float: 'right' }} onClick={() => setStep(1)}>{t('rec.edit')}</button></h3><p>{enumLabel('experienceLevel', values.experienceLevel)}{values.experienceYearsMin && ' | ' + values.experienceYearsMin + ' ' + t('years')}</p><div className={s.tags}>{skills.map((skill) => <span className={s.tag} key={skill.slug || skill.name}>{skill.name}</span>)}</div><p>{languages.map((language) => language.name + ' ' + language.minLevel).join(' | ') || '-'}</p></section><section><h3>{t('rw.screening')} | {questions.length}</h3><p>{t('rw.screeningOptional')}</p>{questions.map((question, index) => <p key={index}>{index + 1}. {question.question}</p>)}</section><LinkedInSharePreview jobId={savedJob?.id} title={values.title} companyName={company?.name || ''} location={shareLocation} employmentType={values.employmentType} workMode={values.workMode} isAnonymous={Boolean(values.isAnonymous)} published={savedJob?.status==='PUBLISHED'} draftKey={shareDraftKey} onPrepare={()=>save(false)} onOpenSettings={openLinkedInSettings} onApprovalChange={setLinkedinApproval} onShareIntentChange={setLinkedinIntent} />{savedJob?.id && <section><button type="button" className={s.textButton} aria-expanded={translationOpen} onClick={() => setTranslationOpen((open) => !open)}>{t('rw.languages')}<WorkspaceIcon kind="right" /></button>{translationOpen && <JobLanguageVersions jobId={savedJob.id} onFlash={(message, tone) => tone === 'error' ? setError(message) : setNotice(message)} />}</section>}</div>}
        </fieldset></form>
      </div>
    </div>
    <footer className={e.footer}><div className={e.footerInner}>
      <button className={s.textButton} type="button" disabled={busy} onClick={() => step ? goTo(step - 1) : void close()}>{step > 0 && <WorkspaceIcon kind="left" />}{t(step ? 'back' : 'cancel')}</button>
      <button className={s.secondary} type="button" disabled={busy} onClick={() => void save(false)}>{t(busy ? 'saving' : savedJob?.status && savedJob.status !== 'DRAFT' ? 'rec.saveChanges' : 'rw.saveDraft')}</button>
      {step < 3 ? <button className={s.primary} type="button" disabled={busy} onClick={() => goTo(step + 1)}>{t('rw.continue')}<WorkspaceIcon kind="arrow" /></button> : savedJob?.status !== 'PUBLISHED' && <button className={s.primary} type="button" disabled={busy || (linkedinIntent && !linkedinApproval)} onClick={() => void save(true)}>{t(packageSelected ? 'rec.publish' : 'commerce.choose')}<WorkspaceIcon kind="arrow" /></button>}
    </div></footer>
  </div>;
}
