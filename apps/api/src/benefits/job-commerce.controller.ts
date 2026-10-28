import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { JobsSearchService } from '../search/jobs-search.service';
import { JobCommerceService } from './job-commerce.service';
import { JobPaymentProvider } from './job-payment.provider';

@Controller('job-commerce')
export class JobCommerceCatalogController {
  constructor(private commerce: JobCommerceService) {}
  @Get('catalog') catalog() { return this.commerce.catalog(); }
}

@Controller('job-commerce/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('RECRUITER', 'SUPER_ADMIN')
export class JobCommerceController {
  constructor(private commerce: JobCommerceService, private search: JobsSearchService) {}
  private async sync<T extends {jobId: string}>(order: T) {
    await this.search.syncJob(order.jobId);
    return order;
  }
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const input = parseDto(z.object({jobId: z.string().min(1).max(100), code: z.enum(['FREE','STANDARD','PREMIUM']),
      intent: z.enum(['PURCHASE','UPGRADE','RENEW'])}).strict(), body);
    return this.sync(await this.commerce.create(user, input, key));
  }
  @Get() list(@CurrentUser() user: AuthUser, @Query('companyId') companyId: string) {
    return this.commerce.list(user, parseDto(z.string().min(1).max(100), companyId));
  }
  @Get('history') history(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const input=parseDto(z.object({companyId:z.string().min(1).max(100),page:z.coerce.number().int().min(1).max(100000).default(1)}),query);
    return this.commerce.history(user,input.companyId,input.page);
  }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.commerce.get(user, id); }
  @Post(':id/cancel') cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.commerce.cancel(user, id); }
  @Post(':id/payment-session') payment(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.commerce.paymentSession(user, id); }
  @Post(':id/complete-test') async test(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.sync(await this.commerce.completeTest(user, id)); }
}

/** Deliberately separate from browser-authenticated routes. A provider adapter
 * must verify the original bytes before the settlement service is invoked. */
@Controller('job-commerce/webhook')
export class JobPaymentWebhookController {
  constructor(private provider: JobPaymentProvider, private commerce: JobCommerceService, private search: JobsSearchService) {}
  @Post()
  async event(@Req() request: Request & {rawBody?: Buffer}) {
    const verified = await this.provider.verify(request.headers, request.rawBody ?? Buffer.alloc(0));
    const order = await this.commerce.settle(this.provider.name, verified);
    await this.search.syncJob(order.jobId);
    return {received: true, orderId: order.id, status: order.status};
  }
}
