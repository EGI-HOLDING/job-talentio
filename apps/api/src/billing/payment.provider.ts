import type { IncomingHttpHeaders } from 'http';

export interface PaymentIntent {
  id: string;
  amountUzs: number;
  purpose: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'MOCKED';
  checkoutUrl?: string;
}

/** Normalized provider webhook event mapped to our payment lifecycle. */
export interface PaymentWebhookEvent {
  /** Provider-side payment id (Payment.externalId). */
  externalId: string;
  status: 'PAID' | 'FAILED';
  raw?: Record<string, unknown>;
}

/**
 * Provider-agnostic payment interface. Real gateways (Stripe/Midtrans) plug in
 * behind the same shape: create a checkout, then confirm exclusively via a
 * signature-verified webhook. Card data never touches our servers or DB.
 */
export interface PaymentProvider {
  /** Provider key stored on Payment.provider and used in webhook routes. */
  readonly name: string;

  createPayment(input: {
    companyId: string;
    amountUzs: number;
    purpose: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentIntent>;

  /** True when the webhook signature matches the raw body. */
  verifySignature(headers: IncomingHttpHeaders, rawBody: Buffer | string): boolean;

  /** Verify + parse a webhook request; throws on bad signature/payload. */
  parseWebhook(headers: IncomingHttpHeaders, rawBody: Buffer | string): PaymentWebhookEvent;

  confirmMock?(paymentId: string): Promise<PaymentIntent>;
}

/** DI token so BillingService stays provider-agnostic (PAYMENTS_PROVIDER env). */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
