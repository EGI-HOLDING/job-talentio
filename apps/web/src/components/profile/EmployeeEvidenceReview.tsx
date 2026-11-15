'use client';
import { useEmployeeIntentText } from '@/lib/i18n/employeeIntent';
import { useEffect, useState } from 'react';
import { LANGUAGE_LEVELS, skillLabelIssue, SKILL_NAME_MAX_LENGTH } from '@job-talentio/shared';
import { api } from '@/lib/api';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { ProfileDialog } from './ProfileDialog';
import { CatalogPositionPicker, usePositionLabels, type PositionValue } from '../ui/CatalogPositionPicker';
import { LookupCombobox } from '../ui/LookupCombobox';
import s from './ProfileWorkspace.module.css';
type Row = {
    key: string;
    source: string;
    confirmed: boolean;
    skillId?: string;
    skillName?: string;
    level?: string | null;
    title?: string;
    jobTitleId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    isCurrent?: boolean;
    seniority?: string | null;
    code?: string;
};
type Kind = 'SKILL' | 'EXPERIENCE' | 'ROLE' | 'LANGUAGE';
type Evidence = {
    exclusions?: Array<{
        kind: Kind;
        key: string;
    }>;
    skillLabels?: Array<{
        id: string;
        name: string;
        nameId?: string | null;
    }>;
    versionId: string;
    status: string;
    revision: number;
    conflicts: string[];
    facts: Record<'skills' | 'experiences' | 'roles' | 'languages', Row[]> | null;
};
const collections = { SKILL: 'skills', EXPERIENCE: 'experiences', ROLE: 'roles', LANGUAGE: 'languages' } as const;
export function EmployeeEvidenceReview({ resumeId, versionId, onClose }: {
    resumeId: string;
    versionId: string;
    onClose: () => void;
}) {
    const m = useEmployeeIntentText();
    const { locale, t } = useI18n();
    const enumLabel = useEnumLabel();
    const id = locale === 'id';
    const [data, setData] = useState<Evidence | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState<{
        kind: Kind;
        row: Row;
        position?: PositionValue;
    } | null>(null), [languages, setLanguages] = useState<Array<{
        code: string;
        name: string;
    }>>([]);
    const skillLabel = (row: Row) => {
        const label = data?.skillLabels?.find(skill => skill.id === row.skillId);
        return (id ? label?.nameId : null) || label?.name || '';
    };
    const positionId = editing?.row.jobTitleId;
    const positionLabels = usePositionLabels(positionId && !editing?.position ? 'ROLE:' + positionId : '');
    const endpoint = `/profiles/me/resumes/${resumeId}/versions/${versionId}/matching-evidence`;
    useEffect(() => { let active = true; let timer: ReturnType<typeof setTimeout> | undefined; const load = () => api<Evidence>(endpoint).then(result => { if (active) {
        setData(result);
        if (['PENDING', 'PROCESSING'].includes(result.status))
            timer = setTimeout(load, 5000);
    } }).catch(e => { if (active)
        setError(e.message); }); void api(endpoint, { method: 'POST' }).then(load).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; clearTimeout(timer); }; }, [endpoint]);
    useEffect(() => { let active = true; api<typeof languages>('/meta/languages', { auth: false }).then(rows => { if (active)
        setLanguages(rows); }).catch(() => { }); return () => { active = false; }; }, []);
    async function mutate(kind: Kind, row: Row, operation: 'UPSERT' | 'EXCLUDE' | 'RESET') {
        if (!data || busy) return;
        if (kind === 'SKILL' && operation === 'UPSERT'
            && (row.skillName === undefined ? !row.skillId : skillLabelIssue(row.skillName))) {
            setError(t('skillNameInvalid'));
            return;
        }
        setBusy(true);
        setError('');
        let value: Record<string, unknown> | undefined;
        if (operation === 'UPSERT')
            value = kind === 'SKILL' ? { ...(row.skillName === undefined ? { skillId: row.skillId } : { name: row.skillName.trim() }), level: row.level || null } : kind === 'ROLE' ? { title: row.title, jobTitleId: row.jobTitleId } : kind === 'LANGUAGE' ? { code: row.code, level: row.level || null } : { title: row.title, jobTitleId: row.jobTitleId || null, startDate: row.startDate || null, endDate: row.isCurrent ? null : row.endDate || null, isCurrent: Boolean(row.isCurrent), seniority: row.seniority || null };
        try {
            const updated = await api<Evidence>(endpoint, { method: 'PATCH', body: JSON.stringify({ kind, key: row.key, operation, revision: data.revision, ...(value ? { value } : {}) }) });
            setData(updated);
            setEditing(null);
            window.dispatchEvent(new Event('employee-matching-updated'));
        }
        catch (e) {
            const message=(e as Error).message;
            setError(message.includes('CV_SKILL_DUPLICATE') ? t('skillNameDuplicate')
                : message.includes('CV_LANGUAGE_DUPLICATE') ? t('languageAlreadyAdded') : message);
            try {
                setData(await api<Evidence>(endpoint));
            }
            catch { /* preserve the actionable save error */ }
        }
        finally {
            setBusy(false);
        }
    }
    const names: Record<Kind, string> = { SKILL: t('skills'), EXPERIENCE: t('experience'), ROLE: m("cvOccupations"), LANGUAGE: t('languages') };
    function add(kind: Kind) { setEditing({ kind, row: { key: 'user:' + crypto.randomUUID(), source: 'USER', confirmed: false, skillId: '', level: null, title: '', jobTitleId: null, startDate: null, endDate: null, isCurrent: false, seniority: null, code: '' } }); }
    return <ProfileDialog title={m("reviewCVMatchingEvidence")} wide busy={busy} onClose={onClose}><div className={s.form}><p>{m("versionScopeHint")}</p>{error && <p role="alert" className={s.formError}>{error}</p>}{!data ? <p>{t('loading')}</p> : data.status !== 'READY' ? <div role="status"><p>{data.status === 'FAILED' ? (m("evidenceFailed")) : (m("cvEvidenceProcessing"))}</p>{data.status === 'FAILED' && <button type="button" onClick={async () => { setBusy(true); try {
            await api(`/profiles/me/resumes/${resumeId}/parse`, { method: 'POST' });
            onClose();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        } }}>{m("readCVAgain")}</button>}</div> : <>
  {data.exclusions?.map(row => <button type="button" key={row.kind + row.key} disabled={busy} onClick={() => void mutate(row.kind, { key: row.key, source: 'USER', confirmed: true }, 'RESET')}>{m("restoreExcludedEvidence")}: {names[row.kind]}</button>)}
  {data.conflicts.map(key => <div key={key} role="status"><p>{m("correctionConflict")}</p>{(['SKILL', 'EXPERIENCE', 'ROLE', 'LANGUAGE'] as Kind[]).map(kind => <button key={kind} type="button" disabled={busy} onClick={() => void mutate(kind, { key, source: 'USER', confirmed: true }, 'RESET')}>{m("resetCorrection")}: {names[kind]}</button>)}</div>)}
  {(['SKILL', 'EXPERIENCE', 'ROLE', 'LANGUAGE'] as Kind[]).map(kind => <section key={kind}><h3>{names[kind]}</h3>{data.facts?.[collections[kind]].map(row => <div key={row.key} className={s.editList}><strong>{row.title || skillLabel(row) || languages.find(l => l.code === row.code)?.name || row.skillId || row.code}</strong><small>{row.confirmed ? (m("confirmed")) : (m("readFromCV"))}{row.level ? '  /  ' + row.level : ''}</small><div><button className={s.secondary} type="button" disabled={busy} onClick={() => setEditing({ kind, row: { ...row } })}>{m("reviewCorrect")}</button><button className={s.textButton} type="button" disabled={busy} onClick={() => void mutate(kind, row, 'EXCLUDE')}>{m("exclude")}</button>{row.source === 'USER' && <button type="button" className={s.textButton} disabled={busy} onClick={() => void mutate(kind, row, 'RESET')}>{m("undoCorrection")}</button>}</div></div>)}<button type="button" disabled={busy} className={s.secondary} onClick={() => add(kind)}>{m("add")} {names[kind]}</button></section>)}
  {editing && <section style={{ border: '1px solid var(--border)', padding: 16 }}><h3>{names[editing.kind]}</h3><fieldset disabled={busy} className={s.resetFieldset}>
    {editing.kind === 'SKILL' && <label>{t('skillName')}<input autoFocus type="text" maxLength={SKILL_NAME_MAX_LENGTH}
      value={editing.row.skillName ?? skillLabel(editing.row)}
      onChange={event => {setError('');setEditing({ ...editing, row: { ...editing.row, skillName: event.target.value } });}}
      autoComplete="off"
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void mutate('SKILL',editing.row,'UPSERT'); } }}
    /></label>}
    {['ROLE', 'EXPERIENCE'].includes(editing.kind) && <><label>{m("cvJobTitle")}<input maxLength={160} value={editing.row.title || ''} onChange={e => setEditing({ ...editing, row: { ...editing.row, title: e.target.value } })}/></label>
      <CatalogPositionPicker label={t('emp.positionTitle')}
        value={positionId ? [editing.position ?? positionLabels?.[0] ?? { id: positionId, kind: 'ROLE', name: positionId }] : []}
        onChange={([position]) => setEditing({ ...editing, position, row: { ...editing.row, jobTitleId: position?.id ?? null, title: editing.row.title || position?.name || '' } })} />
    </>}
    {editing.kind === 'EXPERIENCE' && <><label>{m("startDateHint")}<input type="date" value={editing.row.startDate?.slice(0, 10) || ''} onChange={e => setEditing({ ...editing, row: { ...editing.row, startDate: e.target.value || null } })}/></label><label><input type="checkbox" checked={Boolean(editing.row.isCurrent)} onChange={e => setEditing({ ...editing, row: { ...editing.row, isCurrent: e.target.checked, endDate: e.target.checked ? null : editing.row.endDate } })}/>{m("currentlyWorking")}</label><label>{m("endDate")}<input type="date" disabled={editing.row.isCurrent} value={editing.row.endDate?.slice(0, 10) || ''} onChange={e => setEditing({ ...editing, row: { ...editing.row, endDate: e.target.value || null } })}/></label><label>{m("seniority")}<select value={editing.row.seniority || ''} onChange={e => setEditing({ ...editing, row: { ...editing.row, seniority: e.target.value || null } })}><option value="">{m("unknown")}</option>{['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'].map(v => <option key={v} value={v}>{enumLabel('experienceLevel', v)}</option>)}</select></label></>}
    {editing.kind === 'LANGUAGE' && <>
      {!!editing.row.code && <p><strong>{languages.find(l => l.code === editing.row.code)?.name ?? editing.row.code}</strong></p>}
      <LookupCombobox kind="languages" focusSuggestions disabled={busy}
        excludedCodes={data.facts?.languages.flatMap(row => row.key !== editing.row.key && row.code ? [row.code] : [])}
        onPick={item => setEditing({ ...editing, row: { ...editing.row, code: item.code ?? item.slug } })} />
    </>}
    {['SKILL', 'LANGUAGE'].includes(editing.kind) && <label>{m("levelYouConfirm")}<select value={editing.row.level || ''} onChange={e => setEditing({ ...editing, row: { ...editing.row, level: e.target.value || null } })}><option value="">{m("unknown")}</option>{(editing.kind === 'SKILL' ? ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] : LANGUAGE_LEVELS).map(level => <option key={level} value={level}>{editing.kind === 'LANGUAGE' ? enumLabel('cefr', level) : level}</option>)}</select></label>}
    <button type="button" className={s.primary} disabled={editing.kind === 'LANGUAGE' && !editing.row.code} onClick={() => void mutate(editing.kind, editing.row, 'UPSERT')}>{m("confirmAndSave")}</button><button type="button" className={s.secondary} onClick={() => setEditing(null)}>{t('cancel')}</button></fieldset></section>}
 </>}</div></ProfileDialog>;
}
