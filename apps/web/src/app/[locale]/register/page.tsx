'use client';
import { AuthLink } from '@/components/auth/AuthLink';
import { authDestination } from '@/lib/authReturn';

import { Link, localeHref } from '@/lib/navigation';
import { FormEvent, Suspense, useEffect, useId, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, saveSession } from '@/lib/api';
import { FormAlert, FormField, PasswordInput } from '@/components/ui/Field';
import { GoogleSignIn } from '@/components/auth/GoogleSignIn';
import { TelegramSignIn } from '@/components/auth/TelegramSignIn';
import { PhoneSignIn } from '@/components/auth/PhoneSignIn';
import { useI18n } from '@/lib/i18n';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import s from '@/components/auth/Register.module.css';

type InvitePreview = { companyName: string; email: string; role: string };

/** Split "I agree to the {terms} and {privacy}" and drop links into the slots. */
function renderConsentSentence(template: string, slots: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{[a-z]+\})/g).map((part, index) => {
    const slot = part.match(/^\{([a-z]+)\}$/)?.[1];
    if (slot && slots[slot] !== undefined) return slots[slot];
    return <span key={`text-${index}`}>{part}</span>;
  });
}

function RegisterForm() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite')?.trim() ?? '';
  const roleParam = searchParams.get('role');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const role = inviteToken || roleParam === 'RECRUITER' ? 'RECRUITER' : 'EMPLOYEE';
  const employer = role === 'RECRUITER';
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [inviteInvalid, setInviteInvalid] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));
  const formHintId = useId();
  const termsId = useId();
  const joining = Boolean(invite);
  const useInvite = Boolean(inviteToken) && !inviteInvalid;

  useEffect(() => { setError(''); setAcceptTerms(false); }, [role]);

  useEffect(() => {
    if (!inviteToken) {
      setInviteLoading(false);
      return;
    }
    let cancelled = false;
    setInviteLoading(true);
    api<InvitePreview>(`/companies/invites/${encodeURIComponent(inviteToken)}`, { auth: false })
      .then((preview) => {
        if (cancelled) return;
        setInvite(preview);
        setInviteInvalid(false);
      })
      .catch(() => {
        if (cancelled) return;
        setInvite(null);
        setInviteInvalid(true);
      })
      .finally(() => {
        if (!cancelled) setInviteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const fullName = String(fd.get('fullName') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    const confirmPassword = String(fd.get('confirmPassword') ?? '');
    const companyName = String(fd.get('companyName') ?? '').trim();

    if (!fullName || !email || !password) {
      setError(t('authFillRequired'));
      return;
    }
    if (password.length < 8) {
      setError(t('passwordHint'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'));
      return;
    }
    if (inviteLoading) return;
    if (role === 'RECRUITER' && !useInvite && companyName.length < 2) {
      setError(t('companyNameRequired'));
      return;
    }
    if (!acceptTerms) {
      setError(t('mustAcceptTerms'));
      return;
    }

    setLoading(true);
    try {
      const session = await api<{ accessToken: string; user: { role: string } }>('/auth/register', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          email,
          password,
          fullName,
          role: useInvite ? 'RECRUITER' : role,
          locale,
          acceptTerms: true,
          companyName: role === 'RECRUITER' && !useInvite ? companyName : undefined,
          inviteToken: useInvite ? inviteToken : undefined,
        }),
      });
      saveSession(session as Parameters<typeof saveSession>[0]);
      window.location.href = localeHref(
        authDestination(session.user.role === 'RECRUITER' ? '/dashboard/recruiter?tab=jobs' : '/jobs?mode=for-you'),
      );
    } catch (err) {
      setError((err as Error).message || t('authRegisterFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={s.page + (employer ? ' ' + s.employerPage : '')}>
      <div className={s.layout}>
      <aside className={`${s.story} ${employer ? s.employer : s.seeker}`}>
        <div className={s.storyTop}>
          <span className={s.eyebrow}>{t(employer ? 'registerUi.employerLabel' : 'registerUi.seekerLabel')}</span>
          <h2>{t(employer ? 'registerUi.employerHeadline' : 'registerUi.seekerHeadline')}</h2>
          <p>{t(employer ? 'registerUi.employerStory' : 'registerUi.seekerStory')}</p>
        </div>
        <ol className={s.benefits}>
          {(employer ? ['briefcase', 'document', 'message'] : ['user', 'document', 'search']).map((icon, index) =>
            <li key={icon}><span className={s.benefitIcon}><WorkspaceIcon kind={icon} /></span><span>{t(`registerUi.${employer ? 'employer' : 'seeker'}Benefit${index + 1}`)}</span></li>)}
        </ol>
      </aside>
      <section className={s.formPanel} aria-labelledby="register-title">
        <div className={s.formInner}>
        <span className={s.roleBadge}><WorkspaceIcon kind={employer ? 'briefcase' : 'user'} />{t(employer ? 'registerUi.employerLabel' : 'registerUi.seekerLabel')}</span>
        <h1 id="register-title">{useInvite ? t('inviteJoinTitle') : t(employer ? 'authRole.employerRegister' : 'authRole.employeeRegister')}</h1>
        <p className={s.subtitle}>
          {inviteLoading
            ? t('inviteChecking')
            : joining
              ? t('inviteJoinSubtitle').replace('{company}', invite?.companyName ?? '')
              : t(employer ? 'authRole.employerRegisterSub' : 'authRole.employeeRegisterSub')}
        </p>
        {inviteInvalid ? <FormAlert>{t('inviteInvalid')}</FormAlert> : null}
        {joining ? <p className={s.login}>{t('alreadyRegistered')}{' '}<AuthLink href="/login" accountRole="RECRUITER">{t('login')}</AuthLink></p> : null}
        <div className={s.social}>
          <GoogleSignIn key={`google-${role}`} accountRole={role} inviteToken={useInvite ? inviteToken : undefined} showWhenUnavailable autoCreateEmployeeOnFirstSignIn={!employer} />
          <TelegramSignIn key={`telegram-${role}`} accountRole={role} inviteToken={useInvite ? inviteToken : undefined} showWhenUnavailable autoCreateEmployeeOnFirstSignIn={!employer} />
          {/* New phone accounts use the existing job seeker registration flow. */}
          {!useInvite && !employer && <PhoneSignIn accountRole="EMPLOYEE" showWhenUnavailable />}
        </div>
        <div className={s.divider}><span>{t('registerUi.withEmail')}</span></div>
        <p id={formHintId} className="sr-only">
          {t('requiredFieldsNote')}
        </p>
        <form key={`${role}-${inviteToken}`} className={s.form} onSubmit={onSubmit} aria-describedby={formHintId}>
          <FormField label={t('fullName')} required>
            <input name="fullName" autoComplete="name" minLength={2} required />
          </FormField>
          <FormField label={t('email')} required>
            <input
              key={invite?.email ?? 'email'}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              spellCheck={false}
              defaultValue={invite?.email ?? ''}
              readOnly={joining}
              disabled={inviteLoading}
            />
          </FormField>
          <div className={s.passwords}>
          <FormField label={t('password')} required hint={t('passwordHint')}>
            <PasswordInput name="password" autoComplete="new-password" minLength={8} required />
          </FormField>
          <FormField label={t('confirmPassword')} required>
            <PasswordInput
              name="confirmPassword"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </FormField>
          </div>
          {role === 'RECRUITER' && !useInvite && (
            <FormField label={t('companyName')} required>
              <input name="companyName" autoComplete="organization" minLength={2} required />
            </FormField>
          )}
          <label className={s.terms} htmlFor={termsId}>
            <input
              id={termsId}
              type="checkbox"
              required
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              aria-required="true"
            />
            <span>
              {renderConsentSentence(t('acceptTermsTemplate'), {
                terms: (
                  <Link key="terms" href="/terms" target="_blank" rel="noopener">
                    {t('termsOfServiceObject')}
                  </Link>
                ),
                privacy: (
                  <Link key="privacy" href="/privacy" target="_blank" rel="noopener">
                    {t('privacyPolicyObject')}
                  </Link>
                ),
              })}
              <abbr className="field-req" title={t('required')}>
                *
              </abbr>
            </span>
          </label>
          <FormAlert>{error}</FormAlert>
          <button
            type="submit"
            className={s.submit}
            disabled={loading || inviteLoading}
            aria-busy={loading || inviteLoading}
          >
            {loading ? t('creatingAccount') : t('createAccount')}{!loading && <WorkspaceIcon kind="arrow" />}
          </button>
        </form>
        <p className={s.login}>
          {t('alreadyRegistered')}{' '}
          <AuthLink href="/login" accountRole={role}>
            {t('login')}
          </AuthLink>
        </p>
        {!useInvite && <div className={s.switchRole}><span>{t(employer ? 'registerUi.seekerSwitchPrompt' : 'registerUi.employerSwitchPrompt')}</span><AuthLink href="/register" accountRole={employer ? 'EMPLOYEE' : 'RECRUITER'} next={null}>{t(employer ? 'registerUi.seekerSwitch' : 'registerUi.employerSwitch')}<WorkspaceIcon kind="right" /></AuthLink></div>}
        </div>
      </section>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
