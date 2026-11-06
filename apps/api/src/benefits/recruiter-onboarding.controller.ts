import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { RecruiterOnboardingService } from './recruiter-onboarding.service';

@Controller('recruiter-onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('RECRUITER')
export class RecruiterOnboardingController {
  constructor(private onboarding: RecruiterOnboardingService) {}
  @Get() state(@CurrentUser() user: AuthUser) { return this.onboarding.state(user); }
  @Patch() save(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.onboarding.save(user, parseDto(z.object({companyId: z.string().min(1).max(100).nullable().optional(),
      locale: z.enum(['uz', 'ru', 'en', 'id']).optional(),
      jobId: z.string().min(1).max(100).nullable().optional(), step: z.number().int().min(1).max(3),
      preferredPackage: z.enum(['FREE', 'STANDARD', 'PREMIUM']).optional(),
      flowVersion:z.literal(2).optional(),phase:z.enum(['COMPANY','INTRO','PACKAGE','CHECKOUT','JOB']).optional(),expectedRevision:z.number().int().nonnegative().optional(),
      companyDraft: z.object({name: z.string().max(160), description: z.string().max(5000), website: z.string().max(500),
        countryId: z.string().max(100), citySlug: z.string().max(120), industrySlug: z.string().max(120).optional(), industryGroupCode: z.string().max(80).optional(), industryGroupCodes:z.array(z.string().max(80)).max(29).optional(),profileSource:z.enum(['MANUAL','DOCUMENT']).optional(),profileDocumentId:z.string().max(100).nullable().optional(),logoAssetId:z.string().max(100).optional(),size: z.string().max(30)}).strict().optional()}).strict(), body));
  }
  @Post('complete') complete(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.onboarding.complete(user, parseDto(z.object({skipJob: z.boolean().default(false)}).strict(), body).skipJob);
  }
}
