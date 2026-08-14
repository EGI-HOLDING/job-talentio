'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, localeHref } from '@/lib/navigation';
import { api, getSession, saveSession, logout, AuthSession } from '@/lib/api';
import { useEnumLabel, useI18n, Locale } from '@/lib/i18n';
import { FormAlert, FormField, LabelText, PasswordInput } from '@/components/ui/Field';
import { ImageCropUpload } from '@/components/ui/ImageCropUpload';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { TelegramSignIn } from '@/components/auth/TelegramSignIn';

type Section = 'account' | 'preferences' | 'privacy' | 'security';

const SETTINGS_SECTIONS: Section[] = ['account', 'preferences', 'privacy', 'security'];
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
  const { t, locale, setLocale } = useI18n();
  const enumLabel = useEnumLabel();
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

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);
  const isEmployee = session?.user.role === 'EMPLOYEE';
  const isRecruiter = session?.user.role === 'RECRUITER';
  const canVerifyEmail = (isEmployee || isRecruiter) && Boolean(session?.user.email);
  const hasPassword = session?.user.hasPassword !== false;
  const hasEmail = Boolean(session?.user.email);
  const previewAvatar =
    avatarUrl ||
    (session
      ? `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(session.user.fullName)}`
      : '');

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    setSession(s);
    setFullName(s.user.fullName);
    setAvatarUrl(s.user.avatarUrl || '');
    setPrefLocale((s.user.locale as Locale) || locale);
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
        .then((r) => setBulkOptedOut(r.optedOut))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function applyHash() {
      const hash = window.location.hash.replace(/^#/, '');
      if (!isSettingsSection(hash)) return;
      if (hash === 'privacy' && getSession()?.user.role !== 'EMPLOYEE') return;
      setSection(hash);
    }
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  function goToSection(next: Section) {
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
    setPwMsg(null);
    setErr(null);
    try {
      const session = await api<AuthSession>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (session.accessToken) saveSession(session);
      setPwMsg(t('ui.passwordUpdated'));
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('ui.passwordChangeFailed'));
    }
  }

  async function requestEmailChange(e: React.FormEvent) {
    e.preventDefault();
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

  if (!session) return null;

  const openBotChip = TELEGRAM_BOT_URL ? (
    <a className="chip" href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
      {t('telegramOpenBot')}
    </a>
  ) : null;

  return (
    <div className="shell">
      {confirmUnlink ? (
        <ConfirmModal
          title={t('telegramUnlinkTitle')}
          message={t('telegramUnlinkMessage')}
          confirmLabel={t('ui.telegramUnlink')}
          danger
          busy={telegramBusy}
          onCancel={() => {
            if (!telegramBusy) setConfirmUnlink(false);
          }}
          onConfirm={() => void unlinkTelegram()}
        />
      ) : null}
      {confirmDelete ? (
        <ConfirmModal
          title={t('ui.deleteAccountTitle')}
          message={t('ui.deleteAccountHint')}
          confirmLabel={t('ui.deleteAccount')}
          danger
          busy={deleteBusy}
          requireTypedValue={session.user.email || session.user.fullName}
          typedLabel={
            session.user.email ? t('ui.deleteAccountConfirmEmail') : t('ui.deleteAccountConfirmName')
          }
          onCancel={() => {
            if (!deleteBusy) setConfirmDelete(false);
          }}
          onConfirm={() => void deleteAccount()}
        />
      ) : null}
      <div className="settings-layout">
        <aside className="settings-nav">
          {(
            [
              ['account', t('account')],
              ['preferences', t('language')],
              ...(isEmployee ? [['privacy', t('ui.privacy')] as [Section, string]] : []),
              ['security', t('security')],
            ] as Array<[Section, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={section === k ? 'active' : ''}
              onClick={() => goToSection(k)}
            >
              {label}
            </button>
          ))}
        </aside>

        <section>
          <div className="settings-hero card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewAvatar} alt="" />
            <div>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.5rem' }}>
                {fullName || session.user.fullName}
              </h1>
              <p className="muted" style={{ margin: '0.35rem 0' }}>
                {session.user.email || t('addEmailTitle')}
              </p>
              <span className="badge skill">{enumLabel('role', session.user.role)}</span>
            </div>
          </div>

          {err && (
            <div style={{ marginBottom: '1rem' }}>
              <FormAlert>{err}</FormAlert>
            </div>
          )}
          {msg && (
            <div style={{ marginBottom: '1rem' }}>
              <FormAlert tone="success">{msg}</FormAlert>
            </div>
          )}
          {pwMsg && (
            <div style={{ marginBottom: '1rem' }}>
              <FormAlert tone="success">{pwMsg}</FormAlert>
            </div>
          )}

          {section === 'account' && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('account')}</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                {t('updateProfileHint')}
              </p>
              {(isEmployee || isRecruiter) && !hasEmail && (
                <div
                  style={{
                    marginBottom: '1.25rem',
                    padding: '0.85rem 1rem',
                    borderRadius: 12,
                    background: 'rgba(245, 158, 11, 0.12)',
                  }}
                >
                  <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>{t('addEmailTitle')}</p>
                  <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                    {t('addEmailHint')}
                  </p>
                  <button type="button" onClick={() => setSection('security')}>
                    {t('addEmailCta')}
                  </button>
                </div>
              )}
              {canVerifyEmail && (
                <div
                  style={{
                    marginBottom: '1.25rem',
                    padding: '0.85rem 1rem',
                    borderRadius: 12,
                    background: session.user.emailVerified
                      ? 'rgba(16, 185, 129, 0.08)'
                      : 'rgba(245, 158, 11, 0.12)',
                  }}
                >
                  <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>
                    {session.user.email} -{' '}
                    {session.user.emailVerified
                      ? t('emailVerifiedBadge')
                      : t('emailUnverifiedBadge')}
                  </p>
                  {!session.user.emailVerified && (
                    <>
                      <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                        {t('verifyEmailProfileHint')}
                      </p>
                      <button
                        type="button"
                        disabled={verifyBusy}
                        onClick={() => requestEmailVerification()}
                      >
                        {verifyBusy ? t('verifyEmailSending') : t('verifyEmailCta')}
                      </button>
                    </>
                  )}
                </div>
              )}
              <p className="required-note">{t('requiredFieldsNote')}</p>
              <form onSubmit={saveAccount} className="form-stack">
                <FormField label={t('fullName')} required>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={2} />
                </FormField>
                <ImageCropUpload
                  mode="avatar"
                  label={t('ui.profilePhoto')}
                  value={avatarUrl}
                  uploadPath="/auth/me/avatar"
                  clearPath="/auth/me/avatar"
                  onUploaded={(url) => {
                    setAvatarUrl(url || '');
                    const s = getSession();
                    if (s) {
                      const next = {
                        ...s,
                        user: { ...s.user, avatarUrl: url || null },
                      };
                      saveSession(next);
                      setSession(next);
                    }
                    setMsg(t('ui.photoUpdated'));
                  }}
                />
                <FormField label={t('avatarUrl')} hint={t('ui.avatarUrlHint')}>
                  <input
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://..."
                    type="url"
                  />
                </FormField>
                <button type="submit" disabled={saving}>
                  {saving ? t('saving') : t('save')}
                </button>
              </form>
            </div>
          )}

          {section === 'preferences' && (
            <>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('language')}</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                {t('languagePreference')}
              </p>
              <p className="required-note">{t('languageApplied')}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveAccount(e);
                }}
                className="form-stack"
              >
                <FormField label={t('language')} required>
                  <select
                    value={prefLocale}
                    onChange={(e) => {
                      const next = e.target.value as Locale;
                      setPrefLocale(next);
                      setLocale(next);
                    }}
                  >
                    <option value="uz">O&apos;zbekcha</option>
                    <option value="ru">Русский</option>
                    <option value="en">English</option>
                  </select>
                </FormField>
                <button type="submit" disabled={saving}>
                  {saving ? t('saving') : t('save')}
                </button>
              </form>
            </div>
            {isEmployee && (
              <div className="card" style={{ marginTop: '1rem' }}>
                <h3 style={{ marginTop: 0 }}>{t('ui.telegramAlerts')}</h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  {t('ui.telegramAlertsHint')}
                </p>
                <p>
                  <strong>{telegramLinked ? t('ui.telegramLinked') : t('ui.telegramNotLinked')}</strong>
                </p>
                <div className="chips">
                  {!telegramLinked ? (
                    <button type="button" className="chip" onClick={() => goToSection('security')}>
                      {t('ui.telegramConnectInSecurity')}
                    </button>
                  ) : (
                    openBotChip
                  )}
                  <button
                    type="button"
                    className="chip"
                    disabled={telegramBusy}
                    onClick={() => void refreshTelegramStatus().catch(() => undefined)}
                  >
                    {t('ui.telegramRefresh')}
                  </button>
                </div>
              </div>
            )}
            </>
          )}

          {section === 'privacy' && isEmployee && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('ui.privacy')}</h3>
              <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
                {t('ui.privacyBulkIntro')}
              </p>
              <form onSubmit={savePrivacy} className="form-stack">
                <label className="settings-choice">
                  <input
                    type="checkbox"
                    checked={bulkOptedOut}
                    onChange={(e) => setBulkOptedOut(e.target.checked)}
                  />
                  <span className="settings-choice-copy">
                    <strong>{t('ui.optOutBulkTitle')}</strong>
                    <span className="muted">{t('ui.optOutBulkHint')}</span>
                  </span>
                </label>
                <div className="settings-form-actions">
                  <button type="submit" disabled={privacyLoading}>
                    {privacyLoading ? t('saving') : t('save')}
                  </button>
                </div>
              </form>
            </div>
          )}

          {section === 'security' && (
            <div className="card">
              {hasPassword ? (
                <>
                  <h3 style={{ marginTop: 0 }}>{t('changePassword')}</h3>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {t('ui.passwordRuleHint')}
                  </p>
                  <p className="required-note">{t('requiredFieldsNote')}</p>
                  <form onSubmit={changePassword} className="form-stack">
                    <label>
                      <LabelText required>{t('currentPassword')}</LabelText>
                      <PasswordInput
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                        aria-required="true"
                        autoComplete="current-password"
                      />
                    </label>
                    <label>
                      <LabelText required>{t('newPassword')}</LabelText>
                      <PasswordInput
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        aria-required="true"
                        minLength={8}
                        autoComplete="new-password"
                        aria-describedby={newPassword ? 'pw-strength' : undefined}
                      />
                      {newPassword && (
                        <>
                          <div className="pw-strength" aria-hidden="true">
                            <span style={{ width: `${strength.score}%`, background: strength.color }} />
                          </div>
                          <span id="pw-strength" className="muted" style={{ fontSize: '0.8rem' }}>
                            {t('ui.passwordStrength')}: {t(strength.labelKey)}
                          </span>
                        </>
                      )}
                    </label>
                    <button type="submit">{t('changePassword')}</button>
                  </form>
                </>
              ) : (
                <>
                  <h3 style={{ marginTop: 0 }}>{t('changePassword')}</h3>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {t('passwordlessHint')}
                  </p>
                </>
              )}

              <h3 style={{ marginTop: '2rem' }}>{t('telegramConnectTitle')}</h3>
              {telegramLinked ? (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {t('telegramConnected')}
                  </p>
                  <p className="muted">{t('telegramOpenBotHint')}</p>
                  <div className="chips">
                    {openBotChip}
                    <button
                      type="button"
                      className="chip"
                      disabled={telegramBusy}
                      onClick={() => setConfirmUnlink(true)}
                    >
                      {t('ui.telegramUnlink')}
                    </button>
                    <button
                      type="button"
                      className="chip"
                      disabled={telegramBusy}
                      onClick={() => void refreshTelegramStatus().catch(() => undefined)}
                    >
                      {t('ui.telegramRefresh')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {t('telegramConnectHint')}
                  </p>
                  <TelegramSignIn
                    mode="connect"
                    onConnected={() => {
                      const s = getSession();
                      if (s) {
                        setSession(s);
                        setTelegramLinked(Boolean(s.user.telegramLinked));
                      }
                      setMsg(t('telegramConnected'));
                    }}
                  />
                  {!TELEGRAM_BOT ? (
                    <div className="chips" style={{ marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        className="chip"
                        disabled={telegramBusy}
                        onClick={() => void linkTelegram()}
                      >
                        {t('ui.telegramLink')}
                      </button>
                    </div>
                  ) : null}
                </>
              )}

              <h3 style={{ marginTop: '2rem' }}>
                {hasEmail ? t('ui.changeEmail') : t('addEmailTitle')}
              </h3>
              <p className="muted" style={{ marginTop: 0 }}>
                {hasEmail ? t('ui.changeEmailHint') : t('addEmailHint')}
              </p>
              <form onSubmit={requestEmailChange} className="form-stack">
                <FormField label={hasEmail ? t('ui.newEmail') : t('email')} required>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </FormField>
                {hasPassword ? (
                  <label>
                    <LabelText required>{t('currentPassword')}</LabelText>
                    <PasswordInput
                      value={emailChangePassword}
                      onChange={(e) => setEmailChangePassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                  </label>
                ) : null}
                <button type="submit">
                  {hasEmail ? t('ui.sendConfirmation') : t('addEmailCta')}
                </button>
              </form>

              {session.user.role !== 'SUPER_ADMIN' ? (
                <>
                  <h3 style={{ marginTop: '2rem' }}>{t('ui.deleteAccountTitle')}</h3>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {t('ui.deleteAccountHint')}
                  </p>
                  {ownerBlock ? (
                    <p className="muted">
                      {t('ui.deleteAccountOwnerHint')}{' '}
                      {isRecruiter ? (
                        <a href={localeHref('/dashboard/recruiter')}>{t('ui.goToCompanySettings')}</a>
                      ) : null}
                    </p>
                  ) : null}
                  {hasPassword ? (
                    <label className="form-stack" style={{ display: 'block', marginBottom: '0.75rem' }}>
                      <LabelText required>{t('ui.deleteAccountPassword')}</LabelText>
                      <PasswordInput
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        autoComplete="current-password"
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="danger"
                    disabled={deleteBusy || (hasPassword && !deletePassword)}
                    onClick={() => setConfirmDelete(true)}
                  >
                    {t('ui.deleteAccount')}
                  </button>
                </>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
