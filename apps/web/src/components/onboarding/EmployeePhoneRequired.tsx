'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { phoneDraftFromE164, normalizeE164Phone, validatePhoneDraft, type PhoneDraft } from '@job-talentio/shared';
import { api } from '@/lib/api';
import { safeAuthNext } from '@/lib/authReturn';
import { useRouter } from '@/lib/navigation';
import { useOnboardingText } from '@/lib/i18n/onboarding';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { PhoneNumberField, phoneErrorText } from '@/components/ui/PhoneNumberField';
import s from './EmployeePhoneRequired.module.css';

type PhoneState = {
  status: string;
  profile: {
    phone?: string | null;
    residenceCountry?: { iso2?: string | null } | null;
  };
};

export function EmployeePhoneRequired() {
  const params = useSearchParams();
  const router = useRouter();
  const t = useOnboardingText();
  const destination = safeAuthNext(params.get('next')) || '/dashboard/employee';
  const marketCountry = process.env.NEXT_PUBLIC_DEFAULT_LOCALE === 'id' ? 'ID' : 'UZ';
  const [phone, setPhone] = useState<PhoneDraft>({ country: marketCountry, nationalNumber: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<PhoneState>('/profiles/me/onboarding', { signal: controller.signal })
      .then((state) => {
        if (controller.signal.aborted) return;
        if (state.status === 'IN_PROGRESS') {
          router.replace('/onboarding/employee?next=' + encodeURIComponent(destination));
          return;
        }
        if (normalizeE164Phone(state.profile?.phone)) {
          router.replace(destination);
          return;
        }
        setPhone(phoneDraftFromE164(
          state.profile?.phone,
          state.profile?.residenceCountry?.iso2,
          marketCountry,
        ));
        setLoading(false);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [destination, marketCountry, retry, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setTouched(true);
    setError('');
    setServerError(undefined);
    const result = validatePhoneDraft(phone);
    if (!result.ok) return;
    setBusy(true);
    try {
      await api('/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify({ phone: result.phone }),
      });
      const fresh = await api<PhoneState>('/profiles/me/onboarding');
      if (!normalizeE164Phone(fresh.profile?.phone)) throw new Error('PHONE_INVALID');
      router.replace(destination);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (/^PHONE_(REQUIRED|INVALID|COUNTRY_CODE_REPEATED|COUNTRY_CODE_MISMATCH|NATIONAL_PREFIX|DUPLICATE)$/.test(message)) {
        setServerError(message);
      } else setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <WorkspaceLoading />;
  return (
    <main className={s.page}>
      <section className={s.card} aria-labelledby="phone-required-title">
        <div className={s.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M7 3h3l2 5-2.2 1.8a15 15 0 0 0 4.4 4.4L16 12l5 2v3c0 1.1-.9 2-2 2C10.7 19 5 13.3 5 5c0-1.1.9-2 2-2Z" /></svg>
        </div>
        <p className={s.eyebrow}>{t('identity')}</p>
        <h1 id="phone-required-title">{t('phoneRequiredTitle')}</h1>
        <p className={s.description}>{t('phoneRequiredDescription')}</p>
        {error && <div className={s.loadError} role="alert"><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>{t('retry')}</button></div>}
        <form onSubmit={submit}>
          <PhoneNumberField
            value={phone}
            onChange={(value) => { setPhone(value); setServerError(undefined); setError(''); }}
            label={t('phone')}
            hint={t('phoneHint')}
            required
            disabled={busy}
            errorCode={serverError || (touched && !validatePhoneDraft(phone).ok
              ? (validatePhoneDraft(phone) as { ok: false; error: string }).error
              : undefined)}
          />
          <button className={s.submit} type="submit" disabled={busy}>
            {busy ? t('saving') : t('phoneRequiredContinue')}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>
          </button>
        </form>
      </section>
    </main>
  );
}
