'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Link } from '@/lib/navigation';
import { api } from '@/lib/api';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { FormField } from '@/components/ui/Field';
import { NumberInput } from '@/components/ui/NumberInput';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { SkillCombobox } from '@/components/ui/SkillCombobox';
import { JobTitleInput } from '@/components/ui/JobTitleInput';
import { WorkspaceSelect } from '@/components/jobs/WorkspaceSelect';
import { ProfileDialog } from './ProfileDialog';
import { ProfileIcon } from './ProfileIcon';
import { dateValue, type CareerProfile, type City, type ProfileEditor } from './types';
import s from './ProfileWorkspace.module.css';

const SKILL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'];
const DEGREES = ['HIGH_SCHOOL', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'PHD'];

function CityChoice({ initial }: { initial?: City | null }) {
  const { t } = useI18n();
  const [city, setCity] = useState<{ name: string; slug: string } | null>(initial || null);
  return <div className={s.cityChoice}><span className={s.cityLabel}>{t('city')}</span>
    <input type="hidden" name="citySlug" value={city?.slug || ''} />
    {city ? <div className={s.selectedCity}><span><ProfileIcon kind="pin" />{city.name}</span><button type="button" className={s.iconButton} aria-label={t('pc.remove')} onClick={() => setCity(null)}><ProfileIcon kind="close" /></button></div> : <LookupCombobox focusSuggestions kind="cities" allowCreate={false} onPick={(item) => setCity(item)} submitLabel={t('pc.chooseCity')} />}
  </div>;
}

export function ProfileForms({ editor, profile, onClose, onSaved }: { editor: ProfileEditor; profile: CareerProfile; onClose: () => void; onSaved: (message?: string) => Promise<void> }) {
  const { t } = useI18n();
  const enumLabel = useEnumLabel();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const experience = profile.experiences.find((row) => row.id === editor.id);
  const education = profile.educations.find((row) => row.id === editor.id);
  const certification = profile.certifications.find((row) => row.id === editor.id);
  const [current, setCurrent] = useState(experience?.isCurrent || false);
  const titles = {
    basics: t('pc.editProfile'), skills: t('pc.editSkills'), languages: t('pc.editLanguages'),
    experience: t(editor.id ? 'pc.editExperience' : 'pc.addExperience'),
    education: t(editor.id ? 'pc.editEducation' : 'pc.addEducation'),
    certification: t(editor.id ? 'pc.editCertification' : 'pc.addCertification'),
  };

  async function mutate(path: string, method: string, body?: unknown, close = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      await onSaved(t('pc.saved'));
      if (close) onClose();
    } catch (error) { setError(error instanceof Error ? error.message : t('emp.saveFailed')); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const value = (key: string) => String(fd.get(key) || '').trim();
    const start = value('startDate'), end = value('endDate');
    if (start && end && end < start && !(editor.kind === 'experience' && current)) { setError(t('pc.dateOrder')); return; }
    if (editor.kind === 'basics') {
      await mutate('/profiles/me', 'PATCH', { headline: value('headline'), summary: value('summary'), citySlug: value('citySlug') || null, phone: value('phone'), desiredPosition: value('desiredPosition'), desiredSalaryMin: value('desiredSalaryMin') ? Number(value('desiredSalaryMin')) : null }, true);
    } else {
      const kind = editor.kind === 'experience' ? 'experiences' : editor.kind === 'education' ? 'educations' : 'certifications';
      const body = editor.kind === 'experience'
        ? { title: value('title'), companyName: value('companyName'), citySlug: value('citySlug'), description: value('description'), startDate: start, endDate: current ? null : end || null, isCurrent: current }
        : editor.kind === 'education'
          ? { school: value('school'), degree: value('degree') || undefined, field: value('field'), startDate: start || null, endDate: end || null }
          : { name: value('name'), issuer: value('issuer'), issuedAt: value('issuedAt') || null, expiresAt: value('expiresAt') || null, credentialUrl: value('credentialUrl') };
      if (editor.kind === 'certification' && value('issuedAt') && value('expiresAt') && value('expiresAt') < value('issuedAt')) { setError(t('pc.dateOrder')); return; }
      await mutate(`/profiles/me/${kind}${editor.id ? `/${editor.id}` : ''}`, editor.id ? 'PATCH' : 'POST', body, true);
    }
  }

  const listEditor = editor.kind === 'skills' || editor.kind === 'languages';
  return <ProfileDialog title={titles[editor.kind]} subtitle={editor.kind === 'basics' ? t('pc.basicsHint') : undefined} onClose={onClose} busy={busy} guardChanges={!listEditor}>
    {error && <div className={s.formError} role="alert">{error}</div>}
    {listEditor ? <div className={s.dialogBody}>
      <fieldset disabled={busy} className={s.resetFieldset}>
        {editor.kind === 'skills' ? <SkillCombobox focusSuggestions disabled={busy} onPick={(item) => mutate('/profiles/me/skills', 'POST', { ...(item.slug ? { slug: item.slug } : { name: item.name }), level: item.level || 'INTERMEDIATE' })} /> : <LookupCombobox focusSuggestions kind="languages" disabled={busy} levelOptions={LANGUAGE_LEVELS.map((value) => ({ value, label: enumLabel('cefr', value) }))} defaultLevel="B1" onPick={(item) => mutate('/profiles/me/languages', 'POST', { ...(item.code || item.slug ? { code: item.code || item.slug } : { name: item.name }), level: item.level || 'B1' })} />}
        <div className={s.editList}>
          {(editor.kind === 'skills' ? profile.skills : profile.languages).map((row) => {
            const name = 'skill' in row ? row.skill.name : row.language.name;
            const kind = editor.kind === 'skills' ? 'skills' : 'languages';
            return <div key={row.id}><strong>{name}</strong><WorkspaceSelect value={row.level} label={t('emp.levelFor').replace('{name}', name)} onChange={(level) => void mutate(`/profiles/me/${kind}/${row.id}`, 'PATCH', { level })} options={(kind === 'skills' ? SKILL_LEVELS : LANGUAGE_LEVELS).map((value) => ({ value, label: enumLabel(kind === 'skills' ? 'skillLevel' : 'cefr', value) }))} /><button className={s.iconButton} type="button" aria-label={`${t('pc.remove')}: ${name}`} onClick={() => void mutate(`/profiles/me/${kind}/${row.id}`, 'DELETE')}><ProfileIcon kind="trash" /></button></div>;
          })}
        </div>
      </fieldset>
      <div className={s.dialogFooter}><span className={s.quiet}>{busy ? t('saving') : t('pc.changesImmediate')}</span><button className={s.primary} type="button" disabled={busy} onClick={onClose}>{t('pc.done')}</button></div>
    </div> : <form onSubmit={submit} className={s.form}>
      <fieldset disabled={busy} className={s.resetFieldset}>
        {editor.kind === 'basics' && <>
          <FormField label={t('emp.headline')}><input name="headline" defaultValue={profile.headline || ''} maxLength={200} /></FormField>
          <FormField label={t('emp.summary')}><textarea name="summary" rows={4} defaultValue={profile.summary || ''} maxLength={5000} /></FormField>
          <div className={s.formGrid}><CityChoice initial={profile.city} /><FormField label={t('emp.phone')}><input type="tel" name="phone" maxLength={40} defaultValue={profile.phone || ''} autoComplete="tel" /></FormField></div>
          <div className={s.formGrid}><FormField label={t('emp.desiredPosition')}><JobTitleInput focusSuggestions name="desiredPosition" defaultValue={profile.desiredPosition || ''} /></FormField><FormField label={t('emp.desiredSalary')}><NumberInput name="desiredSalaryMin" min={0} defaultValue={profile.desiredSalaryMin} /></FormField></div>
          <p className={s.inlineNote}><ProfileIcon kind="info" />{t('pc.managedInSettings')} <Link href="/settings">{t('pc.manageAccount')}</Link></p>
        </>}
        {editor.kind === 'experience' && <>
          <div className={s.formGrid}><FormField label={t('emp.positionTitle')} required><input name="title" defaultValue={experience?.title} required maxLength={160} /></FormField><FormField label={t('company')} required><input name="companyName" defaultValue={experience?.companyName} required maxLength={160} /></FormField></div>
          <CityChoice initial={experience?.city} />
          <div className={s.formGrid}><FormField label={t('emp.start')} required><input name="startDate" type="date" defaultValue={dateValue(experience?.startDate)} required /></FormField><FormField label={t('emp.end')} optional><input name="endDate" type="date" defaultValue={dateValue(experience?.endDate)} disabled={current} /></FormField></div>
          <label className={s.checkbox}><input type="checkbox" checked={current} onChange={(event) => setCurrent(event.target.checked)} />{t('emp.currentlyWorkHere')}</label>
          <FormField label={t('emp.description')} optional><textarea name="description" rows={4} defaultValue={experience?.description || ''} maxLength={5000} /></FormField>
        </>}
        {editor.kind === 'education' && <>
          <FormField label={t('emp.school')} required><input name="school" defaultValue={education?.school} maxLength={200} required /></FormField>
          <div className={s.formGrid}><FormField label={t('emp.degree')}><select name="degree" defaultValue={education?.degree || ''}><option value="">-</option>{DEGREES.map((value) => <option key={value} value={value}>{enumLabel('degree', value)}</option>)}</select></FormField><FormField label={t('emp.field')}><input name="field" defaultValue={education?.field || ''} maxLength={160} /></FormField></div>
          <div className={s.formGrid}><FormField label={t('emp.start')} optional><input name="startDate" type="date" defaultValue={dateValue(education?.startDate)} /></FormField><FormField label={t('emp.end')} optional><input name="endDate" type="date" defaultValue={dateValue(education?.endDate)} /></FormField></div>
        </>}
        {editor.kind === 'certification' && <>
          <FormField label={t('emp.name')} required><input name="name" defaultValue={certification?.name} required maxLength={200} /></FormField>
          <FormField label={t('emp.issuer')}><input name="issuer" defaultValue={certification?.issuer || ''} maxLength={160} /></FormField>
          <div className={s.formGrid}><FormField label={t('emp.issuedAt')} optional><input name="issuedAt" type="date" defaultValue={dateValue(certification?.issuedAt)} /></FormField><FormField label={t('emp.expiresAt')} optional><input name="expiresAt" type="date" defaultValue={dateValue(certification?.expiresAt)} /></FormField></div>
          <FormField label={t('emp.credentialUrl')} optional><input name="credentialUrl" type="url" defaultValue={certification?.credentialUrl || ''} placeholder="https://" /></FormField>
        </>}
      </fieldset>
      <footer className={s.dialogFooter}><button type="button" className={s.secondary} onClick={onClose} disabled={busy}>{t('cancel')}</button><button type="submit" className={s.primary} disabled={busy}>{busy ? t('saving') : t('save')}</button></footer>
    </form>}
  </ProfileDialog>;
}
