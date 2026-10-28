'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, localeHref, Link } from '@/lib/navigation';
import { loginForCurrentPage } from '@/lib/authReturn';
import { api, getSession, saveSession, logout, AuthSession } from '@/lib/api';
import { useI18n, Locale } from '@/lib/i18n';
import { FormAlert, FormField, PasswordInput } from '@/components/ui/Field';
import { ImageCropUpload } from '@/components/ui/ImageCropUpload';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { TelegramSignIn } from '@/components/auth/TelegramSignIn';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { LinkedInIntegrationPanel } from '@/components/recruiter/LinkedInIntegrationPanel';
import ws from '@/components/employee/Workspace.module.css';
import st from '@/components/employee/SettingsWorkspace.module.css';

type Section = 'account' | 'preferences' | 'privacy' | 'integrations' | 'security';

const SETTINGS_SECTIONS: Section[] = ['account', 'preferences', 'privacy', 'integrations', 'security'];
const TELEGRAM_BOT = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const TELEGRAM_BOT_URL = TELEGRAM_BOT ? `https://t.me/${TELEGRAM_BOT}` : '';

function isSettingsSection(value: string): value is Section {
  return (SETTINGS_SECTIONS as string[]).includes(value);
}

function passwordStrength(pw: string): { score: number; labelKey: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  if (score <= 1) return { score: 20, labelKey: 'ui.passwordWeak', color: '#ef4444' };
  if (score === 2) return { score: 40, labelKey: 'ui.passwordFair', color: '#f59e0b' };
  if (score === 3) return { score: 65, labelKey: 'ui.passwordGood', color: '#3b82f6' };
  return { score: 100, labelKey: 'ui.passwordStrong', color: '#10b981' };
}

export default function SettingsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { t, locale, setLocale } = useI18n();
  const [section, setSection] = useState<Section>('account');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [prefLocale, setPrefLocale] = useState<Locale>('uz');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailChangePassword, setEmailChangePassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkOptedOut, setBulkOptedOut] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [ownerBlock, setOwnerBlock] = useState(false);
  const [operationBusy, setOperationBusy] = useState<'password' | 'email' | null>(null);
  const [savedBulkOptOut, setSavedBulkOptOut] = useState(false);
  const accountDirty = Boolean(session && (fullName !== session.user.fullName || avatarUrl !== (session.user.avatarUrl || '')));
  const preferencesDirty = Boolean(session && prefLocale !== (session.user.locale || locale));
  const privacyDirty = bulkOptedOut !== savedBulkOptOut;
  const securityDirty = Boolean(currentPassword || newPassword || newEmail || emailChangePassword || deletePassword);

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);
  const isEmployee = session?.user.role === 'EMPLOYEE';
  const isRecruiter = session?.user.role === 'RECRUITER';
  const canVerifyEmail = (isEmployee || isRecruiter) && Boolean(session?.user.email);
  const hasPassword = session?.user.hasPassword !== false;
  const hasEmail = Boolean(session?.user.email);

  useEffect(() => {
    if (session) window.dispatchEvent(new Event('jt-session-updated'));
  }, [session]);

  useEffect(() => {
    if (!accountDirty && !preferencesDirty && !privacyDirty && !securityDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [accountDirty, preferencesDirty, privacyDirty, securityDirty]);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace(loginForCurrentPage());
      return;
    }
    setSession(s);
    setFullName(s.user.fullName);
    setAvatarUrl(s.user.avatarUrl || '');
    setPrefLocale((s.user.locale as Locale) || locale);
    setTelegramLinked(Boolean(s.user.telegramLinked));
    api<AuthSession>('/auth/me')
      .then((fresh) => {
        saveSession(fresh);
        setSession(fresh);
        setFullName(fresh.user.fullName);
        setAvatarUrl(fresh.user.avatarUrl || '');
        setTelegramLinked(Boolean(fresh.user.telegramLinked));
      })
      .catch(() => undefined);
    if (s.user.role === 'EMPLOYEE') {
      api<{ optedOut: boolean }>('/bulk-comms/opt-out')
        .then((r) => { setBulkOptedOut(r.optedOut); setSavedBulkOptOut(r.optedOut); })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function applyHash() {
      const hash = window.location.hash.replace(/^#/, '');
      if (!isSettingsSection(hash)) return;
      if (hash === 'privacy' && getSession()?.user.role !== 'EMPLOYEE') return;
      if (hash === 'integrations' && getSession()?.user.role !== 'RECRUITER') return;
      setSection(hash);
    }
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  function resetChanges() {
    if (session) { setFullName(session.user.fullName); setAvatarUrl(session.user.avatarUrl || ''); setPrefLocale((session.user.locale as Locale) || locale); }
    setBulkOptedOut(savedBulkOptOut);
    setCurrentPassword(''); setNewPassword(''); setNewEmail(''); setEmailChangePassword(''); setDeletePassword('');
  }

  async function goToSection(next: Section) {
    if (next === section || saving || privacyLoading || operationBusy || telegramBusy || deleteBusy) return;
    const dirty = section === 'account'
      ? accountDirty
      : section === 'preferences'
        ? preferencesDirty
        : section === 'privacy'
          ? privacyDirty
          : section === 'security'
            ? securityDirty
            : false;
    if (dirty && !(await confirm({ title: t('pc.unsaved'), confirmLabel: t('pc.discard'), cancelLabel: t('pc.keepEditing'), tone: 'danger' }))) return;
    if (dirty) resetChanges();
    setSection(next);
    setMsg(null);
    setErr(null);
    setPwMsg(null);
    window.history.replaceState(null, '', `#${next}`);
  }

  async function savePrivacy(e: React.FormEvent) {
    e.preventDefault();
    setPrivacyLoading(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await api<{ optedOut: boolean }>('/bulk-comms/opt-out', {
        method: 'PATCH',
        body: JSON.stringify({ optedOut: bulkOptedOut }),
      });
      setBulkOptedOut(r.optedOut);
      setSavedBulkOptOut(r.optedOut);
      setMsg(r.optedOut ? t('ui.bulkOptedOutMsg') : t('ui.bulkOptedInMsg'));
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('ui.privacyUpdateFailed'));
    } finally {
      setPrivacyLoading(false);
    }
  }

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const updated = await api<AuthSession>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, locale: prefLocale, avatarUrl: avatarUrl || '' }),
      });
      saveSession(updated);
      setSession(updated);
      setFullName(updated.user.fullName);
      setAvatarUrl(updated.user.avatarUrl || '');
      setLocale(prefLocale);
      setMsg(t('ui.profileSaved'));
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('ui.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (operationBusy) return;
    setOperationBusy('password');
    setPwMsg(null);
    setErr(null);
    try {
      const session = await api<AuthSession>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (session.accessToken) { saveSession(session); setSession(session); }
      setPwMsg(t('ui.passwordUpdated'));
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('ui.passwordChangeFailed'));
    } finally {
      setOperationBusy(null);
    }
  }

  async function requestEmailChange(e: React.FormEvent) {
    e.preventDefault();
    if (operationBusy) return;
    setOperationBusy('email');
    setPwMsg(null);
    setErr(null);
    try {
      const r = await api<{ message?: string }>('/auth/change-email', {
        method: 'POST',
        body: JSON.stringify({
          newEmail,
          ...(hasPassword ? { currentPassword: emailChangePassword } : {}),
        }),
      });
      setPwMsg(r.message || t('ui.emailChangeCheckInbox'));
      setNewEmail('');
      setEmailChangePassword('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('ui.emailChangeFailed'));
    } finally {
      setOperationBusy(null);
    }
  }

  async function requestEmailVerification() {
    setVerifyBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await api<{ message?: string; alreadyVerified?: boolean; email: string }>(
        '/auth/request-verification',
        { method: 'POST' },
      );
      if (r.alreadyVerified && session) {
        const next = {
          ...session,
          user: { ...session.user, emailVerified: true },
        };
        saveSession(next);
        setSession(next);
        setMsg(t('emailVerifiedBadge'));
      } else {
        setMsg(r.message || `${t('verifyEmailSentTo')} ${r.email}`);
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('verifyEmailFailed'));
    } finally {
      setVerifyBusy(false);
    }
  }

  async function refreshTelegramStatus() {
    const fresh = await api<AuthSession>('/auth/me');
    saveSession(fresh);
    setSession(fresh);
    setTelegramLinked(Boolean(fresh.user.telegramLinked));
  }

  async function linkTelegram() {
    setTelegramBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api<{ url: string }>('/auth/telegram/link', { method: 'POST' });
      window.open(r.url, '_blank', 'noopener,noreferrer');
      setMsg(t('ui.telegramAlertsHint'));
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('ui.telegramLinkFailed'));
    } finally {
      setTelegramBusy(false);
    }
  }

  async function unlinkTelegram() {
    setTelegramBusy(true);
    setErr(null);
    try {
      await api('/auth/telegram/link', { method: 'DELETE' });
      await refreshTelegramStatus();
      setConfirmUnlink(false);
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('ui.telegramLinkFailed'));
    } finally {
      setTelegramBusy(false);
    }
  }

  async function deleteAccount() {
    if (!session) return;
    setDeleteBusy(true);
    setErr(null);
    setOwnerBlock(false);
    try {
      await api('/auth/me', {
        method: 'DELETE',
        body: JSON.stringify({
          confirmation: session.user.email || session.user.fullName,
          ...(hasPassword ? { currentPassword: deletePassword } : {}),
        }),
      });
      await logout();
      window.location.href = localeHref('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('ui.deleteAccount');
      setErr(message);
      if (message.includes('Close this company') || message.includes('Transfer ownership')) {
        setOwnerBlock(true);
      }
      setConfirmDelete(false);
    } finally {
      setDeleteBusy(false);
    }
  }

  if (!session) return <section className={ws.root}><WorkspaceLoading /></section>;

  const openBotChip = TELEGRAM_BOT_URL ? <a className={ws.secondary} href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">{t('telegramOpenBot')}</a> : null;
  const sectionIcons: Record<Section, string> = { account: 'user', preferences: 'globe', privacy: 'shield', integrations: 'send', security: 'lock' };
  const sections: Array<[Section, string]> = [['account', t('account')], ['preferences', t('language')], ...(isEmployee ? [['privacy', t('ui.privacy')] as [Section, string]] : []), ...(isRecruiter ? [['integrations', t('li.integrations')] as [Section, string]] : []), ['security', t('security')]];

  return <section className={ws.root} aria-label={t('settings')}>
    {confirmUnlink && <ConfirmModal title={t('telegramUnlinkTitle')} message={t('telegramUnlinkMessage')} confirmLabel={t('ui.telegramUnlink')} danger busy={telegramBusy} onCancel={() => { if (!telegramBusy) setConfirmUnlink(false); }} onConfirm={() => void unlinkTelegram()} />}
    {confirmDelete && <ConfirmModal title={t('ui.deleteAccountTitle')} message={t('ui.deleteAccountHint')} confirmLabel={t('ui.deleteAccount')} danger busy={deleteBusy} requireTypedValue={session.user.email || session.user.fullName} typedLabel={session.user.email ? t('ui.deleteAccountConfirmEmail') : t('ui.deleteAccountConfirmName')} onCancel={() => { if (!deleteBusy) setConfirmDelete(false); }} onConfirm={() => void deleteAccount()} />}
    <div className={st.layout + (isRecruiter ? ' ' + st.employer : '')}>
      <nav className={st.nav} aria-label={t('settings')}>{sections.map(([key, label]) => <button type="button" key={key} aria-current={section === key ? 'page' : undefined} onClick={() => void goToSection(key)}><WorkspaceIcon kind={sectionIcons[key]} />{label}</button>)}</nav>
      <div className={st.content}>
        {(err || msg || pwMsg) && <div className={st.alerts}>{err && <FormAlert>{err}</FormAlert>}{msg && <FormAlert tone="success">{msg}</FormAlert>}{pwMsg && <FormAlert tone="success">{pwMsg}</FormAlert>}</div>}
        <div className={st.scroll} key={section}>
          {section === 'account' && <form id="account-settings-form" className={st.form} onSubmit={saveAccount}><fieldset className={st.fieldset} disabled={saving}>
            <section className={st.row}><div className={st.label}><h2>{t('ui.profilePhoto')}</h2><p>{t('ew.photoHint')}</p></div><div className={st.control + ' ' + st.photo}><ImageCropUpload mode="avatar" value={avatarUrl} fallbackText={session.user.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')} uploadPath="/auth/me/avatar" clearPath="/auth/me/avatar" onUploaded={(url) => { setAvatarUrl(url || ''); const current = getSession(); if (current) { const next = { ...current, user: { ...current.user, avatarUrl: url || null } }; saveSession(next); setSession(next); } setMsg(t('ui.photoUpdated')); }} /><details className={st.advancedPhoto}><summary>{t('ew.imageLink')}</summary><input aria-label={t('avatarUrl')} type="url" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://..." /></details></div></section>
            <section className={st.row}><div className={st.label}><label htmlFor="settings-full-name">{t('fullName')}</label><p>{t('ew.nameHint')}</p></div><div className={st.control}><input id="settings-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={160} required autoComplete="name" /></div></section>
            <section className={st.row}><div className={st.label}><h2>{t('ew.signInEmail')}</h2><p>{t('ew.signInEmailHint')}</p></div><div className={st.control}><div className={st.email}><span>{session.user.email || t('addEmailTitle')}</span>{canVerifyEmail && (session.user.emailVerified ? <span className={st.verified}><WorkspaceIcon kind="check" />{t('emailVerifiedBadge')}</span> : <span className={st.unverified}>{t('emailUnverifiedBadge')}</span>)}</div>{canVerifyEmail && !session.user.emailVerified && <button type="button" className={st.link} disabled={verifyBusy} onClick={() => void requestEmailVerification()}>{t(verifyBusy ? 'verifyEmailSending' : 'verifyEmailCta')}</button>}<div><button type="button" className={st.link} onClick={() => void goToSection('security')}>{t('ew.manageSecurity')}<WorkspaceIcon kind="arrow" /></button></div></div></section>
            {isEmployee && <section className={st.row}><div className={st.label}><h2>{t('ew.careerProfile')}</h2><p>{t('ew.careerProfileHint')}</p></div><div className={st.control}><Link className={ws.secondary} href="/dashboard/employee?tab=profile">{t('ew.openProfile')}<WorkspaceIcon kind="arrow" /></Link></div></section>}
          </fieldset></form>}
          {section === 'preferences' && <><form id="language-settings-form" className={st.form} onSubmit={saveAccount}><section className={st.row}><div className={st.label}><label htmlFor="settings-language">{t('language')}</label><p>{t('languagePreference')}</p></div><div className={st.control}><select id="settings-language" value={prefLocale} onChange={(event) => setPrefLocale(event.target.value as Locale)} disabled={saving}><option value="en">English</option><option value="ru">Русский</option><option value="uz">O'zbekcha</option><option value="id">Indonesia</option></select></div></section></form>{isEmployee && <section className={st.row}><div className={st.label}><h2>{t('ui.telegramAlerts')}</h2><p>{t('ui.telegramAlertsHint')}</p></div><div className={st.control}><span className={st.status} data-connected={telegramLinked}><WorkspaceIcon kind="telegram" />{t(telegramLinked ? 'ui.telegramLinked' : 'ui.telegramNotLinked')}</span><div className={st.inlineActions}>{telegramLinked ? openBotChip : <button type="button" className={ws.secondary} onClick={() => void goToSection('security')}>{t('ui.telegramConnectInSecurity')}</button>}<button type="button" className={ws.textButton} disabled={telegramBusy} onClick={() => void refreshTelegramStatus().catch((error: Error) => setErr(error.message))}>{t('ui.telegramRefresh')}</button><Link href="/dashboard/employee?tab=alerts">{t('workspace.jobAlerts')} →</Link></div></div></section>}</>}
          {section === 'privacy' && isEmployee && <form id="privacy-settings-form" className={st.form} onSubmit={savePrivacy}><section className={st.row}><div className={st.label}><h2>{t('ui.privacy')}</h2><p>{t('ui.privacyBulkIntro')}</p></div><div className={st.control}><label className={st.choice}><input type="checkbox" checked={bulkOptedOut} onChange={(event) => setBulkOptedOut(event.target.checked)} disabled={privacyLoading} /><span><strong>{t('ui.optOutBulkTitle')}</strong><small>{t('ui.optOutBulkHint')}</small></span></label></div></section></form>}
          {section === 'integrations' && isRecruiter && <LinkedInIntegrationPanel />}
          {section === 'security' && <>
            <section className={st.row}><div className={st.label}><h2>{t('changePassword')}</h2><p>{t(hasPassword ? 'ui.passwordRuleHint' : 'passwordlessHint')}</p></div><div className={st.control}>{hasPassword && <form className={st.stack} onSubmit={changePassword}><FormField label={t('currentPassword')} required><PasswordInput value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></FormField><div><FormField label={t('newPassword')} required><PasswordInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" /></FormField>{newPassword && <><div className={st.strength} aria-hidden="true"><i style={{ width: strength.score + '%', background: strength.color }} /></div><span id="workspace-password-strength" className={st.hint} role="status">{t('ui.passwordStrength')}: {t(strength.labelKey)}</span></>}</div><button type="submit" className={ws.primary} disabled={operationBusy !== null || !currentPassword || newPassword.length < 8}>{t(operationBusy === 'password' ? 'saving' : 'changePassword')}</button></form>}</div></section>
            <section className={st.row}><div className={st.label}><h2>{t('telegramConnectTitle')}</h2><p>{t(telegramLinked ? 'telegramOpenBotHint' : 'telegramConnectHint')}</p></div><div className={st.control}>{telegramLinked ? <><span className={st.status} data-connected="true"><WorkspaceIcon kind="check" />{t('telegramConnected')}</span><div className={st.inlineActions}>{openBotChip}<button type="button" className={ws.secondary} disabled={telegramBusy} onClick={() => setConfirmUnlink(true)}>{t('ui.telegramUnlink')}</button><button type="button" className={ws.textButton} disabled={telegramBusy} onClick={() => void refreshTelegramStatus().catch((error: Error) => setErr(error.message))}>{t('ui.telegramRefresh')}</button></div></> : <><TelegramSignIn mode="connect" onConnected={() => { const fresh = getSession(); if (fresh) { setSession(fresh); setTelegramLinked(Boolean(fresh.user.telegramLinked)); } setMsg(t('telegramConnected')); }} />{!TELEGRAM_BOT && <button type="button" className={ws.secondary} disabled={telegramBusy} onClick={() => void linkTelegram()}>{t('ui.telegramLink')}</button>}</>}</div></section>
            <section className={st.row}><div className={st.label}><h2>{t(hasEmail ? 'ui.changeEmail' : 'addEmailTitle')}</h2><p>{t(hasEmail ? 'ui.changeEmailHint' : 'addEmailHint')}</p></div><div className={st.control}><form className={st.stack} onSubmit={requestEmailChange}><FormField label={t(hasEmail ? 'ui.newEmail' : 'email')} required><input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} required autoComplete="email" /></FormField>{hasPassword && <FormField label={t('currentPassword')} required><PasswordInput value={emailChangePassword} onChange={(event) => setEmailChangePassword(event.target.value)} required autoComplete="current-password" /></FormField>}<button type="submit" className={ws.primary} disabled={operationBusy !== null || !newEmail}>{t(operationBusy === 'email' ? 'saving' : hasEmail ? 'ui.sendConfirmation' : 'addEmailCta')}</button></form></div></section>
            {session.user.role !== 'SUPER_ADMIN' && <section className={st.row + ' ' + st.danger}><div className={st.label}><h2>{t('ui.deleteAccountTitle')}</h2><p>{t('ui.deleteAccountHint')}</p></div><div className={st.control}>{ownerBlock && <p className={st.hint}>{t('ui.deleteAccountOwnerHint')}{isRecruiter && <Link href="/dashboard/recruiter?tab=company"> {t('ui.goToCompanySettings')}</Link>}</p>}<div className={st.stack}>{hasPassword && <FormField label={t('ui.deleteAccountPassword')} required><PasswordInput value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" /></FormField>}<div><button type="button" className={ws.danger} disabled={deleteBusy || (hasPassword && !deletePassword)} onClick={() => setConfirmDelete(true)}>{t('ui.deleteAccount')}</button></div></div></div></section>}
          </>}
        </div>
        {(section === 'account' || section === 'preferences' || section === 'privacy') && <footer className={st.actions}><button type="button" className={ws.secondary} disabled={saving || privacyLoading} onClick={resetChanges}>{t('cancel')}</button><button type="submit" form={section === 'account' ? 'account-settings-form' : section === 'privacy' ? 'privacy-settings-form' : 'language-settings-form'} className={ws.primary} disabled={saving || privacyLoading || !(section === 'account' ? accountDirty : section === 'privacy' ? privacyDirty : preferencesDirty)}>{t(saving || privacyLoading ? 'saving' : 'ew.saveChanges')}</button></footer>}
      </div>
    </div>
  </section>;
}
