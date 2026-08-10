import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';

/**
 * Public (unauthenticated) provider webhooks - authenticity comes from the
 * HMAC signature verified against the raw request body, not from a JWT.
 */
@Controller('billing/webhooks')
export class BillingWebhooksController {
  constructor(private billing: BillingService) {}

  @Post(':provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    return this.billing.handleWebhook(provider, req.headers, req.rawBody);
  }
}
