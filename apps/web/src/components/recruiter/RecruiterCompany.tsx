'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { LabelText } from '@/components/ui/Field';
import { LocationFields } from '@/components/ui/LocationFields';
import { ImageCropUpload } from '@/components/ui/ImageCropUpload';
import { SearchField, WorkspaceEmpty, dateLabel } from '@/components/employee/WorkspacePrimitives';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { CompanyVerificationCard } from './CompanyVerificationCard';
import { CompanyLanguageVersions } from './CompanyLanguageVersions';
import { RecruiterAvatar } from './RecruiterPrimitives';
import s from './RecruiterWorkspace.module.css';
import { useEmployerUnsaved } from './useEmployerUnsaved';

function InviteDialog({ onClose, children, title, busy }: { onClose: () => void; children: React.ReactNode; title: string; busy: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null), id = useId();
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,button')?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') { const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href]') || []); const first = items[0], last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="modal" style={{ width: 'min(500px, calc(100vw - 32px))', padding: 28 }}><header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}><h2 id={id} style={{ fontSize: '1.1rem', margin: 0 }}>{title}</h2><button className={s.icon} type="button" disabled={busy} aria-label={t('close')} onClick={onClose}>×</button></header>{children}</div></div>, document.body);
}

type Props = { company: any; companyId: string; meta: any; industryGroups: any[]; canManage: boolean; isOwner: boolean; onReload: () => Promise<void>; onFlash: (message: string, tone?: 'success' | 'error') => void };
export function RecruiterCompany({ company, companyId, meta, industryGroups, canManage, isOwner, onReload, onFlash }: Props) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [tab, setTab] = useState('profile');
  const [invites, setInvites] = useState<any[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [location, setLocation] = useState({ countryId: company.city?.province?.country?.id || '', citySlug: company.city?.slug || '' });
  useEffect(() => { setLocation({ countryId: company.city?.province?.country?.id || '', citySlug: company.city?.slug || '' }); }, [companyId, company.city?.slug]);
  useEmployerUnsaved(dirty, busy);
  async function loadInvites() { if (canManage) setInvites(await api<any[]>('/companies/' + companyId + '/invites')); }
  useEffect(() => { setTab('profile'); setError(''); setDirty(false); setInvites([]); void loadInvites().catch((reason) => setError(reason.message)); }, [companyId, canManage]);
  async function changeTab(next: string) {
    if (busy) return;
    if (dirty && !await confirm({ title: t('rw.discard'), message: t('rw.discardHint'), cancelLabel: t('rw.keepEditing'), confirmLabel: t('discardChanges'), tone: 'danger' })) return;
    setDirty(false); setTab(next); setError('');
  }
  async function mutate(operation: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); await onReload(); await loadInvites(); onFlash(message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('ew.loadFailed')); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await mutate(async () => { await api('/companies/' + companyId, { method: 'PATCH', body: JSON.stringify({ name: form.get('name'), description: form.get('description') || '', website: form.get('website') || '', citySlug: location.citySlug, countryId: location.countryId || null, industrySlug: form.get('industrySlug') || undefined, size: form.get('size') || undefined }) }); setDirty(false); }, t('rec.companyUpdated'));
  }
  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await mutate(async () => { await api('/companies/' + companyId + '/invite', { method: 'POST', body: JSON.stringify({ email: String(form.get('email')).trim(), role: form.get('role'), locale: form.get('locale') }) }); setInviteOpen(false); }, t('rec.memberInvited'));
  }
  const members = (company.members || []).filter((member: any) => [member.user?.fullName, member.user?.email].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <nav className={s.tabs} aria-label={t('company')}>{[['profile', 'rw.companyProfile'], ['team', 'rw.team'], ['verification', 'rw.verification']].map(([value, key]) => <button key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => void changeTab(value)}>{t(key)}</button>)}</nav>
    {tab === 'team' && <div className={s.toolbar}><SearchField value={query} onChange={setQuery} placeholder={t('rec.team')} />{canManage && <button className={s.primary} onClick={() => setInviteOpen(true)}><WorkspaceIcon kind="plus" />{t('rec.inviteMember')}</button>}</div>}
    {error && <div className={s.notice} role="alert">{error}</div>}
    <div className={tab === 'profile' ? s.companyWorkspace : s.legacy}>
      {tab === 'profile' && <div className={s.companyProfile}><section className={s.companyIdentity}><fieldset disabled={!canManage || busy || Boolean(company.anonymizedAt)} style={{ border: 0, padding: 0 }}><ImageCropUpload mode="logo" label={t('rec.companyLogo')} value={company.logoUrl} uploadPath={'/companies/' + companyId + '/logo'} clearPath={'/companies/' + companyId + '/logo'} onUploaded={async () => { await onReload(); onFlash(t('rec.logoUpdated')); }} /></fieldset><h2 style={{ fontSize: '1.1rem', margin: '24px 0 8px' }}>{company.name}</h2><p className={s.emptyNote}>{company.description}</p><Link className={s.textButton} href={'/companies/' + company.slug + '?returnTo=' + encodeURIComponent('/dashboard/recruiter?tab=company&company=' + companyId)}>{t('rec.publicPage')}<WorkspaceIcon kind="external" /></Link></section><div className={s.companyProfileContent}><form className={s.fields} onSubmit={(event) => void save(event)} onChange={() => setDirty(true)} key={company.id + '-profile'}><fieldset disabled={busy || !canManage || Boolean(company.anonymizedAt)} style={{ border: 0, padding: 0, margin: 0 }} className={s.fields}><div className={s.fieldRow}><label><LabelText required>{t('companyName')}</LabelText><input name="name" defaultValue={company.name} required minLength={2} maxLength={200} /></label><label>{t('trustItemWebsite')}<input type="url" name="website" defaultValue={company.website || ''} placeholder="https://..." /></label></div><div className={s.fieldRow}><label>{t('trustItemIndustry')}<select name="industrySlug" defaultValue={company.industry?.slug || ''}><option value="">-</option>{industryGroups.map((group) => <optgroup key={group.slug} label={group.name}>{group.industries.map((industry: any) => <option key={industry.slug} value={industry.slug}>{industry.name}</option>)}</optgroup>)}</select></label><label>{t('trustItemSize')}<select name="size" defaultValue={company.size || ''}><option value="">-</option>{[['SIZE_1_10', '1-10'], ['SIZE_11_50', '11-50'], ['SIZE_51_200', '51-200'], ['SIZE_201_1000', '201-1,000'], ['SIZE_1000_PLUS', '1,000+']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><LocationFields cityRequired={Boolean(location.countryId)} {...location} initialCity={company.city} onChange={next => { setLocation(next); setDirty(true); }} /><label>{t('rec.description')}<textarea name="description" defaultValue={company.description || ''} rows={7} maxLength={20000} /></label><div className={s.actions}><button className={s.primary} disabled={!dirty || busy}>{t(busy ? 'saving' : 'rec.saveCompany')}</button></div></fieldset></form><fieldset disabled={!canManage || busy || Boolean(company.anonymizedAt)} style={{ border: 0, padding: 0 }}><CompanyLanguageVersions companyId={companyId} onFlash={onFlash} /></fieldset>{tab === 'profile' && isOwner && <section className={s.dangerZone}><h3 style={{ fontSize: '.9rem', marginTop: 0 }}>{t('rec.closeCompany')}</h3><p className={s.emptyNote}>{t(company.anonymizedAt ? 'rec.companyAlreadyClosed' : (company.members?.length || 0) > 1 ? 'rec.closeCompanyNeedTransfer' : 'rec.closeCompanyHint')}</p><button className={s.secondary} style={{ color: '#bb3656', borderColor: '#edcbd5' }} disabled={busy || Boolean(company.anonymizedAt) || (company.members?.length || 0) > 1} onClick={() => setClosing(true)}>{t('rec.closeCompany')}</button></section>}</div></div>}
      {tab === 'team' && <div className={s.companyTeam}><div style={{ overflowX: 'auto' }}><table className={s.table}><thead><tr><th>{t('fullName')}</th><th>{t('email')}</th><th>{t('rec.inviteRole')}</th><th>{t('rw.actions')}</th></tr></thead><tbody>{members.map((member: any) => <tr key={member.userId || member.user?.id}><td><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><RecruiterAvatar name={member.user?.fullName || member.user?.email || ''} src={member.user?.avatarUrl} /><strong>{member.user?.fullName}</strong></div></td><td>{member.user?.email || '-'}</td><td><span className={s.status}>{member.role === 'OWNER' ? t('owner') : member.role === 'ADMIN' ? t('rec.roleAdmin') : t('rec.roleRecruiter')}</span></td><td>{canManage && member.role !== 'OWNER' && <div className={s.actions}>{isOwner && <button className={s.textButton} disabled={busy} onClick={async () => { if (await confirm({ title: t('rec.transferOwnership'), message: t('rec.confirmTransferOwnership'), confirmLabel: t('rec.transferOwnership') })) void mutate(() => api('/companies/' + companyId + '/transfer-ownership', { method: 'POST', body: JSON.stringify({ userId: member.userId || member.user?.id }) }), t('rec.ownershipTransferred')); }}>{t('rec.transferOwnership')}</button>}<button className={s.textButton} disabled={busy} style={{ color: '#b73d58' }} onClick={async () => { if (await confirm({ title: t('rec.confirmRemoveMember'), message: member.user?.fullName, confirmLabel: t('rec.remove'), tone: 'danger' })) void mutate(() => api('/companies/' + companyId + '/members/' + (member.userId || member.user?.id), { method: 'DELETE' }), t('rec.memberRemoved')); }}>{t('rec.remove')}</button></div>}</td></tr>)}</tbody></table>{!members.length && <WorkspaceEmpty title={t('rw.noResults')} />}</div>{canManage && <section><h3 style={{ fontSize: '.88rem' }}>{t('rec.pendingInvites')}</h3>{!invites.length ? <p className={s.emptyNote}>{t('rec.noPendingInvites')}</p> : <table className={s.table}><tbody>{invites.map((item) => <tr key={item.id}><td><strong>{item.email}</strong><span className={s.sub}>{item.role} | {dateLabel(item.expiresAt, locale)}</span></td><td><div className={s.actions}><button className={s.textButton} disabled={busy} onClick={() => void mutate(() => api('/companies/' + companyId + '/invite', { method: 'POST', body: JSON.stringify({ email: item.email, role: item.role, locale: item.locale || locale }) }), t('rec.memberInvited'))}>{t('rec.resendInvite')}</button><button className={s.textButton} disabled={busy} onClick={async () => { if (await confirm({ title: t('rec.revokeInvite'), message: item.email, confirmLabel: t('rec.revokeInvite'), tone: 'danger' })) void mutate(() => api('/companies/' + companyId + '/invites/' + item.id, { method: 'DELETE' }), t('rec.inviteRevoked')); }}>{t('rec.revokeInvite')}</button></div></td></tr>)}</tbody></table>}</section>}</div>}
      {tab === 'verification' && <div className={s.companyVerification}><CompanyVerificationCard companyId={companyId} canSubmit={canManage} onFlash={onFlash} onChanged={onReload} /></div>}

    </div>
    {inviteOpen && <InviteDialog title={t('rec.inviteMember')} busy={busy} onClose={() => setInviteOpen(false)}><form className={s.fields} onSubmit={(event) => void invite(event)}><fieldset disabled={busy} className={s.fields} style={{border:0,padding:0,margin:0}}><label><LabelText required>{t('email')}</LabelText><input type="email" name="email" required placeholder="name@company.com" /></label><label>{t('rec.inviteRole')}<select name="role"><option value="RECRUITER">{t('rec.roleRecruiter')}</option><option value="ADMIN">{t('rec.roleAdmin')}</option></select></label><label>{t('rec.inviteEmailLanguage')}<select name="locale" defaultValue={locale}><option value="en">English</option><option value="ru">Русский</option><option value="uz">O‘zbekcha</option></select></label>{error && <p role="alert" style={{ color: '#b73d58' }}>{error}</p>}<div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={() => setInviteOpen(false)}>{t('cancel')}</button><button className={s.primary} disabled={busy}>{t(busy ? 'rec.inviting' : 'rec.inviteMember')}</button></div></fieldset></form></InviteDialog>}
    {closing && <ConfirmModal title={t('rec.closeCompany')} message={t('rec.closeCompanyConfirm')} requireTypedValue={company.name} typedLabel={t('companyName')} confirmLabel={t('rec.closeCompany')} danger busy={busy} onCancel={() => { if (!busy) setClosing(false); }} onConfirm={() => void mutate(async () => { await api('/companies/' + companyId + '/close', { method: 'POST', body: JSON.stringify({ name: company.name }) }); setClosing(false); }, t('rec.companyClosed'))} />}
  </>;
}
