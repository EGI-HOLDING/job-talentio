'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getSession, saveSession, AuthSession } from '@/lib/api';
import { useI18n, Locale } from '@/lib/i18n';
import { FormAlert, FormField, LabelText, PasswordInput } from '@/components/ui/Field';
import { ImageCropUpload } from '@/components/ui/ImageCropUpload';

type Section = 'account' | 'preferences' | 'privacy' | 'security';

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  if (score <= 1) return { score: 20, label: 'Weak', color: '#ef4444' };
  if (score === 2) return { score: 40, label: 'Fair', color: '#f59e0b' };
  if (score === 3) return { score: 65, label: 'Good', color: '#3b82f6' };
  return { score: 100, label: 'Strong', color: '#10b981' };
}

export default function SettingsPage() {
  const router = useRouter();
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

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);
  const isEmployee = session?.user.role === 'EMPLOYEE';
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
      })
      .catch(() => undefined);
    if (s.user.role === 'EMPLOYEE') {
      api<{ optedOut: boolean }>('/bulk-comms/opt-out')
        .then((r) => setBulkOptedOut(r.optedOut))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setMsg(
        r.optedOut
          ? 'You opted out of recruiter bulk messaging'
          : 'You can receive recruiter bulk messages again',
      );
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to update privacy');
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
      setMsg('Profile saved');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setErr(null);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPwMsg('Password updated');
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to change password');
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
          currentPassword: emailChangePassword,
        }),
      });
      setPwMsg(r.message || 'Check the new inbox to confirm the change');
      setNewEmail('');
      setEmailChangePassword('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to start email change');
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

  if (!session) return null;

  return (
    <div className="shell">
      <div className="settings-layout">
        <aside className="settings-nav">
          {(
            [
              ['account', t('account')],
              ['preferences', t('language')],
              ...(isEmployee ? [['privacy', 'Privacy'] as [Section, string]] : []),
              ['security', t('changePassword')],
            ] as Array<[Section, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={section === k ? 'active' : ''}
              onClick={() => {
                setSection(k);
                setMsg(null);
                setErr(null);
                setPwMsg(null);
              }}
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
                {session.user.email}
              </p>
              <span className="badge skill">{session.user.role}</span>
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
              {isEmployee && (
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
                  label="Profile photo"
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
                    setMsg('Photo updated');
                  }}
                />
                <FormField
                  label={t('avatarUrl')}
                  hint="Optional: paste an image URL, or upload & crop above."
                >
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
          )}

          {section === 'privacy' && isEmployee && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Privacy & messaging</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Under GDPR you can opt out of recruiter bulk / mass messages. You will still receive
                application status updates and one-to-one chat if you message a recruiter.
              </p>
              <form onSubmit={savePrivacy} className="form-stack">
                <label
                  style={{
                    display: 'flex',
                    gap: '0.65rem',
                    alignItems: 'flex-start',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={bulkOptedOut}
                    onChange={(e) => setBulkOptedOut(e.target.checked)}
                    style={{ marginTop: '0.25rem' }}
                  />
                  <span>
                    <strong>Opt out of bulk recruiter messaging</strong>
                    <br />
                    <span className="muted" style={{ fontSize: '0.88rem' }}>
                      Recruiters cannot send mass messages to you from the pipeline. Pipeline stage
                      changes may still notify you.
                    </span>
                  </span>
                </label>
                <button type="submit" disabled={privacyLoading}>
                  {privacyLoading ? t('saving') : t('save')}
                </button>
              </form>
            </div>
          )}

          {section === 'security' && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('changePassword')}</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Use at least 8 characters with mixed case and a number.
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
                        Strength: {strength.label}
                      </span>
                    </>
                  )}
                </label>
                <button type="submit">{t('changePassword')}</button>
              </form>

              <h3 style={{ marginTop: '2rem' }}>Change email</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                We will email a confirmation link to the new address. Your login email updates after
                you confirm.
              </p>
              <form onSubmit={requestEmailChange} className="form-stack">
                <FormField label="New email" required>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </FormField>
                <label>
                  <LabelText required>{t('currentPassword')}</LabelText>
                  <PasswordInput
                    value={emailChangePassword}
                    onChange={(e) => setEmailChangePassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </label>
                <button type="submit">Send confirmation</button>
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
