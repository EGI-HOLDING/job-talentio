'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getSession, saveSession, AuthSession } from '@/lib/api';
import { useI18n, Locale } from '@/lib/i18n';
import { FormAlert, FormField, LabelText, PasswordInput } from '@/components/ui/Field';

type Section = 'account' | 'preferences' | 'security';

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
  const [msg, setMsg] = useState<string | null>(null);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  if (!session) return null;

  return (
    <div className="shell">
      <div className="settings-layout">
        <aside className="settings-nav">
          {(
            [
              ['account', t('account')],
              ['preferences', t('language')],
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
              <p className="required-note">{t('requiredFieldsNote')}</p>
              <form onSubmit={saveAccount} className="form-stack">
                <FormField label={t('fullName')} required>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={2} />
                </FormField>
                <FormField
                  label={t('avatarUrl')}
                  hint="Preview updates live above. Leave empty to use initials avatar."
                >
                  <input
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://…"
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
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
