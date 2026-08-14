export type PaymentConfirmDecision =
  | { action: 'already-settled' }
  | { action: 'confirm' }
  | { action: 'reject'; reason: 'failed' | 'not-pending' };

/** Manual confirm and webhooks only settle PENDING rows. FAILED stays failed. */
export function decidePaymentConfirm(status: string): PaymentConfirmDecision {
  if (status === 'MOCKED' || status === 'PAID') return { action: 'already-settled' };
  if (status === 'FAILED') return { action: 'reject', reason: 'failed' };
  if (status !== 'PENDING') return { action: 'reject', reason: 'not-pending' };
  return { action: 'confirm' };
}

export function jobBelongsToPayer(
  job: { companyId: string } | null | undefined,
  companyId: string,
): boolean {
  return Boolean(job && job.companyId === companyId);
}

export function hotJobIsBoostable(job: { status: string } | null | undefined): boolean {
  return job?.status === 'PUBLISHED';
}

export function paymentConfirmRejectMessage(reason: 'failed' | 'not-pending'): string {
  return reason === 'failed'
    ? 'This payment failed and cannot be confirmed.'
    : 'This payment cannot be confirmed.';
}
