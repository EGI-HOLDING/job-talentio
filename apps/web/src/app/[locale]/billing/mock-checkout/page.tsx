'use client';

import { Suspense, useEffect, useState } from 'react';
import { Link } from '@/lib/navigation';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { api, getSession } from '@/lib/api';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { FormAlert } from '@/components/ui/Field';
import { DetailPageSkeleton } from '@/components/ui/Skeleton';
import { formatUzs } from '@/lib/numberFormat';

type Payment = {
  id: string;
  amountUzs: number;
  purpose: string;
  status: string;
  companyId: string;
  metadata?: { plan?: string; jobId?: string; days?: number } | null;
};

function purposeLabel(t: (k: string) => string, purpose: string) {
  if (purpose.startsWith('plan_')) {
    return t('ui.planUpgradeLabel').replace('{plan}', purpose.replace('plan_', ''));
  }
  if (purpose.startsWith('hot_job_')) {
    return t('ui.hotJobBoostLabel').replace('{n}', purpose.replace('hot_job_', ''));
  }
  return purpose;
}

function MockCheckoutInner() {
  const search = useSearchParams();
  const router = useRouter();
  const { t } = useI18n();
  const enumLabel = useEnumLabel();
  const paymentId = search.get('paymentId') || '';
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace(`/login?next=${encodeURIComponent(`/billing/mock-checkout?paymentId=${paymentId}`)}`);
      return;
    }
    if (s.user.role !== 'RECRUITER' && s.user.role !== 'SUPER_ADMIN') {
      router.replace('/');
      return;
    }
    if (!paymentId) {
      setError(t('ui.missingPaymentId'));
      return;
    }

    let cached: Payment | null = null;
    try {
      const raw = sessionStorage.getItem(`billing:payment:${paymentId}`);
      if (raw) cached = JSON.parse(raw) as Payment;
    } catch {
      /* ignore */
    }

    api<Payment>(`/billing/payments/${paymentId}`)
      .then((p) => {
        setPayment(p);
        if (p.status === 'MOCKED' || p.status === 'PAID') setDone(true);
      })
      .catch((e) => {
        if (cached) {
          setPayment(cached);
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : t('ui.loadPaymentFailed'));
        }
      });
  }, [paymentId, router, t]);

  async function confirmPay() {
    if (!paymentId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Payment>(`/billing/payments/${paymentId}/confirm`, {
        method: 'POST',
      });
      setPayment(updated);
      setDone(true);
      try {
        sessionStorage.removeItem(`billing:payment:${paymentId}`);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ui.paymentFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!paymentId) {
    return (
      <div className="shell" style={{ padding: '3rem 1.5rem', maxWidth: 520 }}>
        <FormAlert>{t('ui.missingPaymentId')}</FormAlert>
        <Link href="/dashboard/recruiter?tab=billing" className="chip" style={{ marginTop: '1rem' }}>
          {t('ui.backToBilling')}
        </Link>
      </div>
    );
  }

  if (!payment && !error) return <DetailPageSkeleton />;

  return (
    <div className="shell" style={{ padding: '3rem 1.5rem', maxWidth: 520 }}>
      <div className="card">
        <h1 style={{ marginTop: 0, fontSize: '1.35rem' }}>{t('ui.demoCheckout')}</h1>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          {t('ui.demoCheckoutHint')}
        </p>
        {error && <FormAlert>{error}</FormAlert>}
        {payment && (
          <>
            <p style={{ margin: '1rem 0 0.35rem' }}>
              <strong>{purposeLabel(t, payment.purpose)}</strong>
            </p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.25rem 0 1rem' }}>
              {formatUzs(payment.amountUzs)}
            </p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              {t('ui.status')}: {enumLabel('paymentStatus', payment.status)}
            </p>
            {done ? (
              <div style={{ marginTop: '1.25rem' }}>
                <FormAlert tone="success">{t('ui.paymentConfirmed')}</FormAlert>
                <Link
                  href="/dashboard/recruiter?tab=billing"
                  className="chip active"
                  style={{ marginTop: '1rem', display: 'inline-block' }}
                >
                  {t('ui.backToPlanBilling')}
                </Link>
              </div>
            ) : (
              <button
                type="button"
                style={{ marginTop: '1.25rem' }}
                disabled={busy}
                onClick={confirmPay}
              >
                {busy ? t('ui.processing') : t('ui.payDemo')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function MockCheckoutPage() {
  return (
    <Suspense fallback={<DetailPageSkeleton />}>
      <MockCheckoutInner />
    </Suspense>
  );
}
