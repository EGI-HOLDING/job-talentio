'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { FormAlert, LabelText } from '@/components/ui/Field';
import { JobTitleInput } from '@/components/ui/JobTitleInput';
import { SkillCombobox } from '@/components/ui/SkillCombobox';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { CompanyMark } from '@/components/employee/WorkspacePrimitives';
import { ScreeningQuestionsEditor, screeningDraftsFromJob, type ScreeningQuestionDraft } from './ScreeningQuestionsEditor';
import { JobLanguageVersions } from './JobLanguageVersions';
import s from './RecruiterWorkspace.module.css';
import { useEmployerUnsaved } from './useEmployerUnsaved';

type Pick = { slug: string; name: string; isRequired?: boolean; weight?: number };
type JobLanguage = { code: string; name: string; minLevel: string; isRequired: boolean };
type Props = { companyId: string; company: any; job: any | null; meta: any; onClose: () => void; onSaved: (message: string) => Promise<void> };

export function RecruiterJobEditor({ companyId, company, job, meta, onClose, onSaved }: Props) {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const confirm = useConfirm();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedJob, setSavedJob] = useState(job);
  const [values, setValues] = useState({ title: job?.title || '', description: job?.description || '', citySlug: job?.city?.slug || '', categorySlug: job?.category?.slug || '', experienceLevel: job?.experienceLevel || '', experienceYearsMin: job?.experienceYearsMin == null ? '' : String(job.experienceYearsMin), salaryMin: job?.salaryMin == null ? '' : String(job.salaryMin), salaryMax: job?.salaryMax == null ? '' : String(job.salaryMax), salaryPeriod: job?.salaryPeriod || 'MONTHLY', currency: job?.currency || 'UZS', employmentType: job?.employmentType || 'FULL_TIME', workMode: job?.workMode || 'ONSITE', locale: job?.locale || locale, isAnonymous: Boolean(job?.isAnonymous) });
  const [skills, setSkills] = useState<Pick[]>((job?.jobSkills || job?.skills || []).map((item: any) => ({ slug: item.skill?.slug || item.slug || '', name: item.skill?.name || item.name, isRequired: item.isRequired !== false, weight: item.weight ?? 1 })));
  const [benefits, setBenefits] = useState<Pick[]>((job?.benefits || []).map((item: any) => ({ slug: item.benefit?.slug || item.slug || '', name: item.benefit?.name || item.name })));
  const [languages, setLanguages] = useState<JobLanguage[]>((job?.jobLanguages || []).map((item: any) => ({ code: item.language?.code, name: item.language?.name, minLevel: item.minLevel || 'B1', isRequired: item.isRequired !== false })).filter((item: JobLanguage) => item.code));
  const [questions, setQuestions] = useState<ScreeningQuestionDraft[]>(screeningDraftsFromJob(job || {}));
  const originalQuestions = useRef(screeningDraftsFromJob(job || {}));
  const lastSaved = useRef('');
  const [translationOpen, setTranslationOpen] = useState(false);
  const state = JSON.stringify({ values, skills, benefits, languages, questions });
  if (!lastSaved.current) lastSaved.current = state;
  const dirty = state !== lastSaved.current;
  useEmployerUnsaved(dirty, busy);
  const update = (key: keyof typeof values, value: string | boolean) => setValues((previous) => ({ ...previous, [key]: value }));
  async function close() {
    if (busy) return;
    if (dirty && !await confirm({ title: t('rw.discard'), message: t('rw.discardHint'), confirmLabel: t('discardChanges'), cancelLabel: t('rw.keepEditing'), tone: 'danger' })) return;
    onClose();
  }
  function valid(target = 3, publish = false) {
    if (values.title.trim().length < 3 || values.description.trim().length < 20 || values.currency.trim().length !== 3 || (publish && values.workMode !== 'REMOTE' && !values.citySlug)) { setError(t('rw.requiredFields')); setStep(0); return false; }
    if ([values.salaryMin, values.salaryMax].some((value) => value !== '' && (!Number.isSafeInteger(Number(value)) || Number(value) < 0)) || (values.experienceYearsMin !== '' && (!Number.isInteger(Number(values.experienceYearsMin)) || Number(values.experienceYearsMin) < 0 || Number(values.experienceYearsMin) > 50))) { setError(t('rw.invalidNumber')); return false; }
    if (values.salaryMin && values.salaryMax && Number(values.salaryMax) < Number(values.salaryMin)) { setError(t('rw.salaryRange')); setStep(0); return false; }
    if (target >= 3 && questions.some((question) => question.question.trim().length < 3)) { setError(t('rw.requiredFields')); setStep(2); return false; }
    setError(''); return true;
  }
  function goTo(target: number) { if (target < step || valid(target)) setStep(target); }
  async function removeQuestion(question: ScreeningQuestionDraft) {
    return !question.answerCount || await confirm({ title: t('rec.screeningDeleteConfirm'), message: t('rec.screeningDeleteConfirmBody').replace('{n}', String(question.answerCount)), confirmLabel: t('rec.screeningRemove'), tone: 'danger' });
  }
  async function save(publish = false) {
    if (busy || !valid(3, publish)) return;
    if (publish && !await confirm({ title: t('rw.publishConfirm'), message: t('rw.publishHint'), confirmLabel: t('rec.publish') })) return;
    setBusy(true); setError('');
    let result = savedJob;
    try {
      const payload = { ...values, currency: values.currency.toUpperCase(), title: values.title.trim(), description: values.description.trim(), citySlug: values.citySlug || undefined, categorySlug: values.categorySlug || undefined, experienceLevel: values.experienceLevel || null, experienceYearsMin: values.experienceYearsMin === '' ? null : Number(values.experienceYearsMin), salaryMin: values.salaryMin === '' ? null : Number(values.salaryMin), salaryMax: values.salaryMax === '' ? null : Number(values.salaryMax), skills: skills.map((skill) => ({ ...(skill.slug ? { slug: skill.slug } : { name: skill.name }), isRequired: skill.isRequired !== false, weight: skill.weight ?? 1 })), benefits: benefits.map((benefit) => benefit.slug ? { slug: benefit.slug } : { name: benefit.name }), languages };
      result = await api<any>(savedJob?.id ? '/jobs/' + savedJob.id : '/jobs/company/' + companyId, { method: savedJob?.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      // Persist the ID immediately so retrying a later question request never creates another job.
      result = { ...result, id: result?.id || savedJob?.id };
      setSavedJob(result);
      try {
        for (const old of [...originalQuestions.current]) {
          if (!old.id || questions.some((question) => question.id === old.id)) continue;
          await api('/jobs/' + result.id + '/questions/' + old.id, { method: 'DELETE' });
          originalQuestions.current = originalQuestions.current.filter((question) => question.id !== old.id);
        }
        const next: ScreeningQuestionDraft[] = [];
        for (let index = 0; index < questions.length; index++) {
          const question = questions[index];
          const row = await api<any>('/jobs/' + result.id + '/questions' + (question.id ? '/' + question.id : ''), { method: question.id ? 'PATCH' : 'POST', body: JSON.stringify({ question: question.question.trim(), type: question.type, isRequired: question.isRequired, sortOrder: index }) });
          const updated = { ...question, id: row?.id || question.id };
          originalQuestions.current = [...originalQuestions.current.filter((item) => item.id !== updated.id), updated];
          next.push(updated);
          // Retain successful new-question IDs even if a later request fails.
          setQuestions((current) => current.map((item, i) => i === index ? updated : item));
        }
        originalQuestions.current = next;
        setQuestions(next);
        lastSaved.current = JSON.stringify({ values, skills, benefits, languages, questions: next });
      } catch (reason) {
        throw new Error(t('rw.failedDraft') + (reason instanceof Error ? ' ' + reason.message : ''));
      }
      if (publish) await api('/jobs/' + result.id + '/status', { method: 'POST', body: JSON.stringify({ status: 'PUBLISHED' }) });
      await onSaved(t(publish ? 'rec.jobPublished' : savedJob ? 'rec.jobUpdated' : 'rec.jobCreatedDraft'));
      if (publish) onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('rec.jobUpdateFailed')); }
    finally { setBusy(false); }
  }
  const steps = ['rw.details', 'rw.requirements', 'rw.screening', 'rw.review'];
  const field = (key: keyof typeof values, label: string, options?: { required?: boolean; type?: string; min?: number; max?: number; minLength?: number; maxLength?: number }) => <label><LabelText required={options?.required}>{label}</LabelText><input name={key} value={String(values[key])} type={options?.type || 'text'} min={options?.min} max={options?.max} minLength={options?.minLength} maxLength={options?.maxLength} required={options?.required} onChange={(event) => update(key, event.target.value)} /></label>;
  const select = (key: keyof typeof values, label: string, options: { value: string; label: string }[]) => <label><LabelText>{label}</LabelText><select value={String(values[key])} onChange={(event) => update(key, event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  return <div className={s.editor}>
    <div className={s.context}><button className={s.textButton} type="button" onClick={() => void close()}><WorkspaceIcon kind="left" />{t('rw.backJobs')}</button><strong>{values.title || t('rec.createJob')}</strong><span className={s.status} data-status={savedJob?.status || 'DRAFT'}>{enumLabel('jobStatus', savedJob?.status || 'DRAFT')}</span>{savedJob?.id && <Link href={'/jobs/' + savedJob.id} className={s.textButton}>{t('rec.publicPage')}<WorkspaceIcon kind="external" /></Link>}</div>
    <nav className={s.tabs} aria-label={t('rec.createJob')}>{steps.map((label, index) => <button type="button" key={label} disabled={busy} aria-current={step === index ? 'page' : undefined} onClick={() => goTo(index)}><span className={s.count}>{index + 1}</span>{t(label)}</button>)}</nav>
    {error && <div className={s.notice} role="alert">{error}</div>}{notice && <div className={s.notice} data-tone="success" role="status">{notice}</div>}
    <div className={s.editorColumns}><div className={s.editorForm}><form onSubmit={(event) => { event.preventDefault(); if (step < 3) goTo(step + 1); else void save(false); }}><fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      {step === 0 && <div className={s.fields}>
        <label><LabelText required>{t('jobTitleFilter')}</LabelText><JobTitleInput name="title" value={values.title} onValueChange={(title: string) => update('title', title)} required minLength={3} placeholder={t('rec.jobTitlePlaceholder')} /></label>
        <label><LabelText required>{t('rec.description')}</LabelText><textarea rows={8} maxLength={20000} value={values.description} onChange={(event) => update('description', event.target.value)} minLength={20} required /></label>
        <div className={s.fieldRow}>{select('citySlug', t('city'), [{ value: '', label: '-' }, ...(meta.cities || []).map((city: any) => ({ value: city.slug, label: city.name }))])}{select('workMode', t('workMode'), ['ONSITE', 'HYBRID', 'REMOTE'].map((value) => ({ value, label: enumLabel('workMode', value) })))}</div>
        <div className={s.fieldRow}>{select('employmentType', t('employmentType'), ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'].map((value) => ({ value, label: enumLabel('employmentType', value) })))}{select('locale', t('postLocale'), [{ value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }, { value: 'uz', label: "O‘zbekcha" }])}</div>
        <div className={s.fieldRow}>{field('salaryMin', t('rec.salaryMin'), { type: 'number', min: 0 })}{field('salaryMax', t('rec.salaryMax'), { type: 'number', min: 0 })}</div>
        <div className={s.fieldRow}>{field('currency', t('rec.currency'), { maxLength: 3, minLength: 3, required: true })}{select('salaryPeriod', t('rec.salaryPeriod'), ['MONTHLY', 'YEARLY', 'HOURLY'].map((value) => ({ value, label: t(value === 'MONTHLY' ? 'rec.periodMonthly' : value === 'YEARLY' ? 'rec.periodYearly' : 'rec.periodHourly') })))}</div>
      </div>}
      {step === 1 && <div className={s.fields}>
        <div className={s.fieldRow}>{select('categorySlug', t('category'), [{ value: '', label: '-' }, ...(meta.categories || []).map((category: any) => ({ value: category.slug, label: category.name }))])}{select('experienceLevel', t('experienceLevel'), [{ value: '', label: '-' }, ...['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'].map((value) => ({ value, label: enumLabel('experienceLevel', value) }))])}</div>
        {field('experienceYearsMin', t('rec.minYears'), { type: 'number', min: 0, max: 50 })}
        <div><LabelText>{t('skills')}</LabelText><div className={s.tags}>{skills.map((skill, index) => <span className={s.tag} key={skill.slug || skill.name}>{skill.name}<button type="button" aria-label={t('rec.remove') + ' ' + skill.name} onClick={() => setSkills((items) => items.filter((_, i) => index !== i))}>×</button></span>)}</div><SkillCombobox levelSelect={false} submitLabel={t('rec.addSkillToJob')} onPick={(skill) => { if (skills.length < 30 && !skills.some((item) => (item.slug || item.name) === (skill.slug || skill.name))) setSkills([...skills, { slug: skill.slug, name: skill.name }]); }} /></div>
        <div><LabelText>{t('benefits')}</LabelText><div className={s.tags}>{benefits.map((benefit, index) => <span className={s.tag} key={benefit.slug || benefit.name}>{benefit.name}<button type="button" aria-label={t('rec.remove') + ' ' + benefit.name} onClick={() => setBenefits((items) => items.filter((_, i) => index !== i))}>×</button></span>)}</div><LookupCombobox kind="benefits" allowCreate submitLabel={t('addBenefit')} onPick={(item) => { if (benefits.length < 20 && !benefits.some((existing) => (existing.slug || existing.name) === (item.slug || item.name))) setBenefits([...benefits, item]); }} /></div>
        <div><LabelText>{t('languages')}</LabelText>{languages.map((language, index) => <div className={s.fieldRow} style={{ alignItems: 'center', marginTop: 12 }} key={language.code}><span>{language.name}</span><div className={s.actions}><select aria-label={language.name + ' ' + t('languageLevel')} value={language.minLevel} onChange={(event) => setLanguages((items) => items.map((item, i) => i === index ? { ...item, minLevel: event.target.value } : item))}>{['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'].map((level) => <option key={level}>{level}</option>)}</select><label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={language.isRequired} onChange={(event) => setLanguages((items) => items.map((item, i) => i === index ? { ...item, isRequired: event.target.checked } : item))} />{t('required')}</label><button type="button" className={s.icon} aria-label={t('rec.remove') + ' ' + language.name} onClick={() => setLanguages((items) => items.filter((_, i) => index !== i))}>×</button></div></div>)}{languages.length < 4 && <LookupCombobox kind="languages" allowCreate={false} submitLabel={t('addLanguage')} onPick={(item) => { const code = item.code || item.slug; if (code && !languages.some((language) => language.code === code)) setLanguages([...languages, { code, name: item.name, minLevel: 'B1', isRequired: true }]); }} />}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}><input type="checkbox" checked={values.isAnonymous} onChange={(event) => update('isAnonymous', event.target.checked)} />{t('rec.anonymousPosting')}</label><span className={s.emptyNote}>{t('rec.anonymousPostingHint')}</span>
      </div>}
      {step === 2 && <><p className={s.emptyNote}>{t('rw.screeningOptional')}</p><ScreeningQuestionsEditor idPrefix="recruiter-job" value={questions} onChange={setQuestions} onRemoveSaved={removeQuestion} /></>}
      {step === 3 && <div className={s.review}><section><h3>{t('rw.details')}<button type="button" className={s.textButton} style={{ float: 'right' }} onClick={() => setStep(0)}>{t('rec.edit')}</button></h3><strong>{values.title}</strong><p>{values.description}</p><div className={s.tags}><span className={s.tag}>{enumLabel('workMode', values.workMode)}</span><span className={s.tag}>{enumLabel('employmentType', values.employmentType)}</span></div></section><section><h3>{t('rw.requirements')}<button type="button" className={s.textButton} style={{ float: 'right' }} onClick={() => setStep(1)}>{t('rec.edit')}</button></h3><p>{enumLabel('experienceLevel', values.experienceLevel)}{values.experienceYearsMin && ' | ' + values.experienceYearsMin + ' ' + t('years')}</p><div className={s.tags}>{skills.map((skill) => <span className={s.tag} key={skill.slug || skill.name}>{skill.name}</span>)}</div><p>{languages.map((language) => language.name + ' ' + language.minLevel).join(' | ') || '-'}</p></section><section><h3>{t('rw.screening')} | {questions.length}</h3><p>{t('rw.screeningOptional')}</p>{questions.map((question, index) => <p key={index}>{index + 1}. {question.question}</p>)}</section>{savedJob?.id && <section><button type="button" className={s.textButton} aria-expanded={translationOpen} onClick={() => setTranslationOpen((open) => !open)}>{t('rw.languages')}<WorkspaceIcon kind="right" /></button>{translationOpen && <JobLanguageVersions jobId={savedJob.id} onFlash={(message, tone) => tone === 'error' ? setError(message) : setNotice(message)} />}</section>}</div>}
    </fieldset></form></div><aside className={s.preview}><h2>{t('rw.preview')}</h2><div className={s.previewPaper}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><CompanyMark name={values.isAnonymous ? t('rec.anonymousChip') : company?.name || ''} logo={values.isAnonymous ? undefined : company?.logoUrl} /><strong>{values.isAnonymous ? t('rec.anonymousChip') : company?.name}</strong></div><h3>{values.title || t('jobTitleFilter')}</h3><div className={s.tags}><span className={s.tag}>{enumLabel('workMode', values.workMode)}</span><span className={s.tag}>{enumLabel('employmentType', values.employmentType)}</span></div>{(values.salaryMin || values.salaryMax) && <strong style={{ color: '#078568' }}>{values.currency} {[values.salaryMin, values.salaryMax].filter(Boolean).map((value) => Number(value).toLocaleString(locale)).join(' - ')} / {t(values.salaryPeriod === 'YEARLY' ? 'rec.periodYearly' : values.salaryPeriod === 'HOURLY' ? 'rec.periodHourly' : 'rec.periodMonthly')}</strong>}<h4>{t('rec.description')}</h4><p>{values.description || '-'}</p><h4>{t('rw.requirements')}</h4><div className={s.tags}>{skills.map((skill) => <span className={s.tag} key={skill.slug || skill.name}>{skill.name}</span>)}</div></div></aside></div>
    <footer className={s.formActions}><button className={s.textButton} type="button" disabled={busy} onClick={() => step ? setStep(step - 1) : void close()}><WorkspaceIcon kind="left" />{t(step ? 'back' : 'cancel')}</button><button className={s.secondary} type="button" disabled={busy} onClick={() => void save(false)}>{t(busy ? 'saving' : savedJob?.status && savedJob.status !== 'DRAFT' ? 'rec.saveChanges' : 'rw.saveDraft')}</button>{step < 3 ? <button className={s.primary} type="button" disabled={busy} onClick={() => goTo(step + 1)}>{t('rw.continue')}<WorkspaceIcon kind="arrow" /></button> : savedJob?.status !== 'PUBLISHED' && <button className={s.primary} type="button" disabled={busy} onClick={() => void save(true)}>{t('rec.publish')}<WorkspaceIcon kind="arrow" /></button>}</footer>
  </div>;
}
