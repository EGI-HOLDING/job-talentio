import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { JobPurchaseOrder } from '@prisma/client';

export type VerifiedJobPayment = {
  orderId: string; eventId: string; reference: string; amount: number; currency: string;
};
/** Implement this adapter for Midtrans. Both methods run exclusively on the
 * server; verify must check the signature AND authoritative provider status,
 * currency and settled gross amount. Never trust a browser callback. */
@Injectable()
export class JobPaymentProvider {
  readonly name: string = 'unconfigured';
  readonly available: boolean = false;
  async checkout(_order: JobPurchaseOrder): Promise<{ redirectUrl: string; reference: string }> {
    throw new ServiceUnavailableException('Payment gateway is not connected');
  }
  async verify(_headers: Record<string, unknown>, _rawBody: Buffer): Promise<VerifiedJobPayment> {
    throw new ServiceUnavailableException('Payment gateway is not connected');
  }
}
