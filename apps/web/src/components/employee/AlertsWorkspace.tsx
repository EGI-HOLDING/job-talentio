'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, getSession, saveSession, type AuthSession } from '@/lib/api';
import { Link, useRouter } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { ProfileDialog } from '@/components/profile/ProfileDialog';
import { SkillCombobox } from '@/components/ui/SkillCombobox';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { WorkspaceIcon } from './WorkspaceIcon';
import { Pagination, ResourceError, WorkspaceEmpty, WorkspaceLoading, useEmployeeResource } from './WorkspacePrimitives';
import s from './Workspace.module.css';

type Skill = { slug: string; name: string };
type Alert = {
  id: string; name: string; query?: string | null; city?: { slug: string; name: string } | null;
  frequency: 'DAILY' | 'WEEKLY'; isActive: boolean;
  notifyInApp: boolean; notifyEmail: boolean; notifyTelegram: boolean;
  skills?: { skill: Skill }[];
};
type Draft = {
  name: string; query: string; city: { slug: string; name: string } | null; skills: Skill[];
  frequency: 'DAILY' | 'WEEKLY'; notifyInApp: boolean; notifyEmail: boolean; notifyTelegram: boolean;
};
function draftFrom(alert: Alert | null, linked: boolean): Draft {
  return { name: alert?.name || '', query: alert?.query || '', city: alert?.city || null, skills: alert?.skills?.map((item) => item.skill) || [], frequency: alert?.frequency || 'DAILY', notifyInApp: alert?.notifyInApp !== false, notifyEmail: alert?.notifyEmail !== false, notifyTelegram: Boolean(alert?.notifyTelegram && linked) };
}

function AlertEditor({ alert, linked, onClose, onSaved }: { alert: Alert | null; linked: boolean; onClose: () => void; onSaved: (alert: Alert) => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const router = useRouter();
  const initial = useRef(draftFrom(alert, linked));
  const [draft, setDraft] = useState<Draft>(initial.current);
  const [cityOpen, setCityOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current);
  async function requestClose() {
    if (busy) return false;
    if (dirty && !(await confirm({ title: t('pc.unsaved'), confirmLabel: t('pc.discard'), cancelLabel: t('pc.keepEditing'), tone: 'danger' }))) return false;
    onClose();
    return true;
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.notifyInApp && !draft.notifyEmail && !(draft.notifyTelegram && linked)) { setError(t('ew.channelsRequired')); return; }
    setBusy(true); setError('');
    try {
      const saved = await api<Alert>(alert ? '/alerts/' + alert.id : '/alerts', {
        method: alert ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: draft.name.trim(), query: draft.query.trim(), citySlug: draft.city?.slug || (alert ? null : undefined), skillSlugs: draft.skills.map((item) => item.slug), frequency: draft.frequency, notifyInApp: draft.notifyInApp, notifyEmail: draft.notifyEmail, notifyTelegram: Boolean(draft.notifyTelegram && linked) }),
      });
      onSaved(saved);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('ew.loadFailed')); }
    finally { setBusy(false); }
  }

  return <ProfileDialog title={t(alert ? 'ew.editAlert' : 'emp.createAlert')} busy={busy} onClose={() => void requestClose()}><form className={s.modalForm} onSubmit={save}><fieldset disabled={busy} style={{ margin: 0 }}><label className={s.field}>{t('ew.alertName')} *<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoComplete="off" /></label><div className={s.fieldGrid}><label className={s.field}>{t('emp.keywords')}<input maxLength={200} value={draft.query} onChange={(event) => setDraft({ ...draft, query: event.target.value })} autoComplete="off" /></label><div className={s.field}><span>{t('city')}</span><button type="button" className={s.cityControl} aria-expanded={cityOpen} onClick={() => setCityOpen(!cityOpen)}>{draft.city?.name || t('ew.allLocations')}<WorkspaceIcon kind="chevron" /></button>{draft.city && <button type="button" className={s.textButton} onClick={() => { setDraft({ ...draft, city: null }); setCityOpen(false); }}>{t('ew.allLocations')}</button>}{cityOpen && <div className={s.cityPicker}><LookupCombobox kind="cities" allowCreate={false} focusSuggestions onPick={(city) => { setDraft({ ...draft, city: { slug: city.slug, name: city.name } }); setCityOpen(false); }} /></div>}</div></div><div className={s.field}><span>{t('skills')}</span><div className={s.skillTags} hidden={!draft.skills.length}>{draft.skills.map((skill) => <span className={s.skillTag} key={skill.slug}>{skill.name}<button type="button" aria-label={t('emp.remove') + ': ' + skill.name} onClick={() => setDraft({ ...draft, skills: draft.skills.filter((item) => item.slug !== skill.slug) })}><WorkspaceIcon kind="close" /></button></span>)}</div><SkillCombobox allowCreate={false} levelSelect={false} focusSuggestions onPick={(skill) => { if (draft.skills.length < 20 && !draft.skills.some((item) => item.slug === skill.slug)) setDraft({ ...draft, skills: [...draft.skills, { slug: skill.slug, name: skill.name }] }); }} /></div><fieldset><legend>{t('emp.frequency')}</legend><div className={s.radioOptions}>{(['DAILY', 'WEEKLY'] as const).map((value) => <label key={value}><input type="radio" name="frequency" value={value} checked={draft.frequency === value} onChange={() => setDraft({ ...draft, frequency: value })} />{t(value === 'DAILY' ? 'emp.daily' : 'emp.weekly')}</label>)}</div></fieldset><fieldset><legend>{t('ew.notifyVia')}</legend><div className={s.channelChoices}>{(['notifyInApp', 'notifyEmail', 'notifyTelegram'] as const).map((key) => <label key={key}><input type="checkbox" checked={draft[key]} disabled={key === 'notifyTelegram' && !linked} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} />{t(key === 'notifyInApp' ? 'emp.alertChannelInApp' : key === 'notifyEmail' ? 'emp.alertChannelEmail' : 'emp.alertChannelTelegram')}</label>)}</div>{!linked && <p className={s.sub}>{t('ew.connectTelegramHint')} <button type="button" className={s.textButton} onClick={() => { void requestClose().then((closed) => { if (closed) router.push('/settings#security'); }); }}>{t('settings')}</button></p>}</fieldset></fieldset>{error && <p role="alert" className={s.notice}>{error}</p>}<footer className={s.modalFooter}><button type="button" className={s.secondary} disabled={busy} onClick={() => void requestClose()}>{t('cancel')}</button><button className={s.primary} type="submit" disabled={busy || !draft.name.trim()}>{t(busy ? 'saving' : alert ? 'ew.saveChanges' : 'emp.createAlert')}</button></footer></form></ProfileDialog>;
}

export function AlertsWorkspace() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const resource = useEmployeeResource<Alert>('/alerts');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [linked, setLinked] = useState(false);
  const [editor, setEditor] = useState<{ alert: Alert | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setLinked(Boolean(getSession()?.user.telegramLinked));
    let active = true;
    api<AuthSession>('/auth/me').then((fresh) => { if (active) { saveSession(fresh); setLinked(Boolean(fresh.user.telegramLinked)); } }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    function dismiss(event: MouseEvent) { if (!(event.target instanceof Element) || !event.target.closest('[data-alert-menu]')) setMenuId(null); }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') setMenuId(null); }
    document.addEventListener('click', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('click', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  const visible = useMemo(() => resource.items.filter((item) => filter === 'all' || (filter === 'active' ? item.isActive : !item.isActive)), [resource.items, filter]);
  const safePage = Math.min(page, Math.max(1, Math.ceil(visible.length / 10)));
  useEffect(() => { setPage(1); setMenuId(null); }, [filter]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); setMenuId(null); }, [page]);

  async function toggle(item: Alert) {
    setBusy(item.id); resource.setError(''); setNotice('');
    try { const updated = await api<Alert>('/alerts/' + item.id, { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) }); resource.setItems((items) => items.map((row) => row.id === item.id ? updated : row)); }
    catch (error) { resource.setError(error instanceof Error ? error.message : t('ew.loadFailed')); }
    finally { setBusy(null); }
  }
  async function remove(item: Alert) {
    setMenuId(null);
    if (!(await confirm({ title: t('emp.deleteAlertConfirm'), highlight: item.name, confirmLabel: t('emp.delete'), tone: 'danger' }))) return;
    setBusy(item.id);
    try { await api('/alerts/' + item.id, { method: 'DELETE' }); resource.setItems((items) => items.filter((row) => row.id !== item.id)); resource.setError(''); }
    catch (error) { resource.setError(error instanceof Error ? error.message : t('ew.loadFailed')); }
    finally { setBusy(null); }
  }

  return <section className={s.root} aria-label={t('workspace.jobAlerts')}><div className={s.toolbar + ' ' + s.alertToolbar}><span className={s.total}>{t(resource.items.length === 1 ? 'ew.oneAlert' : 'ew.alertsCount').replace('{n}', String(resource.items.length))}</span><nav className={s.tabs} aria-label={t('ew.status')}>{['all', 'active', 'paused'].map((key) => <button type="button" key={key} className={s.tab} aria-pressed={filter === key} onClick={() => setFilter(key)}>{t(key === 'paused' ? 'emp.paused' : 'ew.' + key)}{key !== 'all' && <span className={s.count}>{resource.items.filter((item) => key === 'active' ? item.isActive : !item.isActive).length}</span>}</button>)}</nav><div className={s.tools}><button type="button" className={s.primary} onClick={() => { setNotice(''); setEditor({ alert: null }); }}><WorkspaceIcon kind="plus" />{t('emp.createAlert')}</button></div></div>
    {resource.error && <ResourceError message={resource.error} onRetry={() => { void resource.reload().catch((error: Error) => resource.setError(error.message)); }} />}{notice && <div className={s.notice} data-tone="success" role="status">{notice}<button type="button" className={s.iconButton} aria-label={t('closeDialog')} onClick={() => setNotice('')}><WorkspaceIcon kind="close" /></button></div>}
    {resource.loading ? <WorkspaceLoading /> : <div ref={scrollRef} className={s.scroll}>{!visible.length ? <WorkspaceEmpty icon="bell" title={t(resource.error && !resource.items.length ? 'ew.loadFailed' : resource.items.length ? 'ew.noResults' : 'ew.alertsEmpty')} hint={resource.error && !resource.items.length ? undefined : t(resource.items.length ? 'ew.adjustSearch' : 'ew.alertsHint')}><button className={s.primary} type="button" onClick={() => setEditor({ alert: null })}><WorkspaceIcon kind="plus" />{t('emp.createAlert')}</button></WorkspaceEmpty> : <table className={s.table + ' ' + s.alertsTable}><colgroup><col style={{ width: '36%' }} /><col style={{ width: '11%' }} /><col style={{ width: '22%' }} /><col style={{ width: '17%' }} /><col style={{ width: '14%' }} /></colgroup><thead><tr><th scope="col">{t('ew.alert')}</th><th scope="col">{t('emp.frequency')}</th><th scope="col">{t('ew.notifyVia')}</th><th scope="col">{t('ew.status')}</th><th scope="col"><span className="sr-only">{t('emp.edit')}</span></th></tr></thead><tbody>{visible.slice((safePage - 1) * 10, safePage * 10).map((item) => <tr key={item.id}><td><div className={s.companyCell}><span className={s.companyMark}><WorkspaceIcon kind="bell" /></span><div className={s.companyText}><button type="button" className={s.titleButton} onClick={() => setEditor({ alert: item })}>{item.name}</button><span className={s.sub}>{[item.query, item.city?.name || t('ew.allLocations'), item.skills?.map((entry) => entry.skill.name).join(', ')].filter(Boolean).join(' \u00b7 ')}</span></div></div></td><td>{t(item.frequency === 'DAILY' ? 'emp.daily' : 'emp.weekly')}</td><td data-mobile="wide">{item.notifyInApp && <span className={s.channel}><WorkspaceIcon kind="bell" />{t('emp.alertChannelInApp')}</span>}{item.notifyEmail && <span className={s.channel}><WorkspaceIcon kind="mail" />{t('emp.alertChannelEmail')}</span>}{item.notifyTelegram && <span className={s.channel} data-kind="telegram"><WorkspaceIcon kind="telegram" />{t('emp.alertChannelTelegram')}{!linked && <WorkspaceIcon kind="info" />}</span>}</td><td><span className={s.switchLabel}><button type="button" role="switch" aria-checked={item.isActive} aria-label={t(item.isActive ? 'ew.pauseAlert' : 'ew.resumeAlert') + ': ' + item.name} className={s.switch} disabled={Boolean(busy)} onClick={() => void toggle(item)} />{t(item.isActive ? 'emp.active' : 'emp.paused')}</span></td><td><div className={s.actions}><button type="button" className={s.textButton} disabled={Boolean(busy)} onClick={() => setEditor({ alert: item })}>{t('emp.edit')}</button><div className={s.menuAnchor} data-alert-menu><button type="button" className={s.iconButton} disabled={Boolean(busy)} aria-label={t('pc.moreActions').replace('{name}', item.name)} aria-expanded={menuId === item.id} onClick={() => setMenuId(menuId === item.id ? null : item.id)}><WorkspaceIcon kind="more" /></button>{menuId === item.id && <div className={s.menu}><button type="button" onClick={() => void remove(item)}><WorkspaceIcon kind="trash" />{t('emp.delete')}</button></div>}</div></div></td></tr>)}</tbody></table>}<div className={s.connection}><WorkspaceIcon kind="telegram" /><span>{t(linked ? 'ui.telegramLinked' : 'ui.telegramNotLinked')}</span><Link href="/settings#security">{t('ew.manageConnection')}</Link></div></div>}
    {!resource.loading && <Pagination page={safePage} total={visible.length} onChange={setPage} />}
    {editor && <AlertEditor key={editor.alert?.id || 'new'} alert={editor.alert} linked={linked} onClose={() => setEditor(null)} onSaved={(updated) => { resource.setItems((items) => editor.alert ? items.map((row) => row.id === updated.id ? updated : row) : [updated, ...items]); setEditor(null); setNotice(t('ew.alertSaved')); resource.setError(''); }} />}
  </section>;
}
