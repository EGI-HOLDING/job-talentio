'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, getSession } from '@/lib/api';
import { FormAlert } from '@/components/ui/Field';
import { DetailPageSkeleton } from '@/components/ui/Skeleton';

type Payment = {
  id: string;
  amountUzs: number;
  purpose: string;
  status: string;
  companyId: string;
  metadata?: { plan?: string; jobId?: string; days?: number } | null;
};

function purposeLabel(purpose: string) {
  if (purpose.startsWith('plan_')) return `Plan upgrade: ${purpose.replace('plan_', '')}`;
  if (purpose.startsWith('hot_job_')) return `Hot job boost: ${purpose.replace('hot_job_', '')} days`;
  return purpose;
}

function formatUzs(n: number) {
  return `${n.toLocaleString('uz-UZ')} UZS`;
}

function MockCheckoutInner() {
  const search = useSearchParams();
  const router = useRouter();
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
      setError('Missing paymentId');
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
          setError(e instanceof Error ? e.message : 'Failed to load payment');
        }
      });
  }, [paymentId, router]);

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
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  if (!paymentId) {
    return (
      <div className="shell" style={{ padding: '3rem 1.5rem', maxWidth: 520 }}>
        <FormAlert>Missing payment id.</FormAlert>
        <Link href="/dashboard/recruiter?tab=billing" className="chip" style={{ marginTop: '1rem' }}>
          Back to billing
        </Link>
      </div>
    );
  }

  if (!payment && !error) return <DetailPageSkeleton />;

  return (
    <div className="shell" style={{ padding: '3rem 1.5rem', maxWidth: 520 }}>
      <div className="card">
        <h1 style={{ marginTop: 0, fontSize: '1.35rem' }}>Demo checkout</h1>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Mock payment — no real charge. Confirm to activate the plan or boost.
        </p>
        {error && <FormAlert>{error}</FormAlert>}
        {payment && (
          <>
            <p style={{ margin: '1rem 0 0.35rem' }}>
              <strong>{purposeLabel(payment.purpose)}</strong>
            </p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.25rem 0 1rem' }}>
              {formatUzs(payment.amountUzs)}
            </p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Status: {payment.status}
            </p>
            {done ? (
              <div style={{ marginTop: '1.25rem' }}>
                <FormAlert tone="success">Payment confirmed.</FormAlert>
                <Link
                  href="/dashboard/recruiter?tab=billing"
                  className="chip active"
                  style={{ marginTop: '1rem', display: 'inline-block' }}
                >
                  Back to Plan & billing
                </Link>
              </div>
            ) : (
              <button
                type="button"
                style={{ marginTop: '1.25rem' }}
                disabled={busy}
                onClick={confirmPay}
              >
                {busy ? 'Processing…' : 'Pay (demo)'}
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
