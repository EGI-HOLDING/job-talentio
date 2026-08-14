import {
  decidePaymentConfirm,
  hotJobIsBoostable,
  jobBelongsToPayer,
  paymentConfirmRejectMessage,
} from './payment-settlement';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function confirmOnlyPending() {
  assert(decidePaymentConfirm('PENDING').action === 'confirm', 'pending must confirm');
  assert(decidePaymentConfirm('MOCKED').action === 'already-settled', 'mocked is idempotent');
  assert(decidePaymentConfirm('PAID').action === 'already-settled', 'paid is idempotent');
  const failed = decidePaymentConfirm('FAILED');
  assert(failed.action === 'reject' && failed.reason === 'failed', 'failed must stay failed');
  const other = decidePaymentConfirm('REFUNDED');
  assert(other.action === 'reject' && other.reason === 'not-pending', 'unknown status is rejected');
  assert(
    paymentConfirmRejectMessage('failed').includes('failed'),
    'failed copy should mention failed',
  );
}

function hotJobMustMatchPayerAndBePublished() {
  assert(jobBelongsToPayer({ companyId: 'co-1' }, 'co-1'), 'same company is ok');
  assert(!jobBelongsToPayer({ companyId: 'co-2' }, 'co-1'), 'other company is not ok');
  assert(!jobBelongsToPayer(null, 'co-1'), 'missing job is not ok');
  assert(hotJobIsBoostable({ status: 'PUBLISHED' }), 'published can boost');
  assert(!hotJobIsBoostable({ status: 'DRAFT' }), 'draft cannot boost');
  assert(!hotJobIsBoostable({ status: 'CLOSED' }), 'closed cannot boost');
  assert(!hotJobIsBoostable(null), 'missing job cannot boost');
}

confirmOnlyPending();
hotJobMustMatchPayerAndBePublished();
console.log('api: payment-settlement smoke ok');
