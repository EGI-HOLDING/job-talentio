import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { planUpgradeSchema, hotJobSchema } from '@job-talentio/shared';
import { BillingService } from './billing.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('RECRUITER', 'SUPER_ADMIN')
export class BillingController {
  constructor(private billing: BillingService) {}

  @Get('companies/:companyId/subscription')
  subscription(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.billing.getSubscription(user, companyId);
  }

  @Post('companies/:companyId/upgrade')
  upgrade(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(planUpgradeSchema, body);
    return this.billing.upgrade(user, companyId, data.plan);
  }

  @Post('companies/:companyId/jobs/:jobId/hot')
  hot(
    @Param('companyId') companyId: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(hotJobSchema, body);
    return this.billing.buyHotJob(user, companyId, jobId, data.days);
  }

  @Get('payments/:paymentId')
  payment(@Param('paymentId') paymentId: string, @CurrentUser() user: AuthUser) {
    return this.billing.getPayment(user, paymentId);
  }

  @Post('payments/:paymentId/confirm')
  confirm(@Param('paymentId') paymentId: string, @CurrentUser() user: AuthUser) {
    return this.billing.confirmPayment(user, paymentId);
  }
}
