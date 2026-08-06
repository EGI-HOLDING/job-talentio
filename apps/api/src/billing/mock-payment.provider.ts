import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PaymentProvider, PaymentIntent } from './payment.provider';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private store = new Map<string, PaymentIntent>();

  async createPayment(input: {
    companyId: string;
    amountUzs: number;
    purpose: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentIntent> {
    const intent: PaymentIntent = {
      id: `mock_${randomUUID()}`,
      amountUzs: input.amountUzs,
      purpose: input.purpose,
      status: 'PENDING',
      checkoutUrl: `${process.env.WEB_URL ?? 'http://localhost:3000'}/billing/mock-checkout?paymentId=pending`,
    };
    this.store.set(intent.id, intent);
    return intent;
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
