export interface PaymentIntent {
  id: string;
  amountUzs: number;
  purpose: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'MOCKED';
  checkoutUrl?: string;
}

export interface PaymentProvider {
  createPayment(input: {
    companyId: string;
    amountUzs: number;
    purpose: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentIntent>;
  confirmMock?(paymentId: string): Promise<PaymentIntent>;
}
