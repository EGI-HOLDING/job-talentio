import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { PaymentProvider, PaymentIntent, PaymentWebhookEvent } from './payment.provider';

/**
 * Mock gateway with production-shaped plumbing: checkout URL + signed webhook.
 * Webhook stubs send `X-Mock-Signature: HMAC-SHA256(PAYMENTS_WEBHOOK_SECRET, rawBody)`.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private store = new Map<string, PaymentIntent>();

  async createPayment(input: {
    companyId: string;
    amountUzs: number;
    purpose: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentIntent> {
    const id = `mock_${randomUUID()}`;
    const base = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const intent: PaymentIntent = {
      id,
      amountUzs: input.amountUzs,
      purpose: input.purpose,
      status: 'PENDING',
      // Real DB payment id is substituted by BillingService.wrapCheckoutResult
      checkoutUrl: `${base}/billing/mock-checkout?paymentId=${encodeURIComponent(id)}`,
    };
    this.store.set(intent.id, intent);
    return intent;
  }

  verifySignature(headers: IncomingHttpHeaders, rawBody: Buffer | string): boolean {
    const secret = process.env.PAYMENTS_WEBHOOK_SECRET;
    if (!secret) return false;
    const header = headers['x-mock-signature'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(headers: IncomingHttpHeaders, rawBody: Buffer | string): PaymentWebhookEvent {
    if (!this.verifySignature(headers, rawBody)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON');
    }
    const externalId = String(body.externalId ?? body.paymentId ?? '');
    const rawStatus = String(body.status ?? '').toUpperCase();
    const status = rawStatus === 'PAID' ? 'PAID' : rawStatus === 'FAILED' ? 'FAILED' : null;
    if (!externalId || !status) {
      throw new BadRequestException('Webhook requires externalId and status PAID|FAILED');
    }
    return { externalId, status, raw: body };
  }

  async confirmMock(paymentId: string): Promise<PaymentIntent> {
    const existing = this.store.get(paymentId);
    if (!existing) {
      return {
        id: paymentId,
        amountUzs: 0,
        purpose: 'unknown',
        status: 'MOCKED',
      };
    }
    existing.status = 'MOCKED';
    this.store.set(paymentId, existing);
    return existing;
  }
}
