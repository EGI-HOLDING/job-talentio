import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  bulkCampaignSchema,
  bulkCommsOptOutSchema,
  messageTemplateSchema,
  messageTemplateUpdateSchema,
} from '@job-talentio/shared';
import { ApplicationStatus } from '@prisma/client';
import { BulkCommsService } from './bulk-comms.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';

@Controller('bulk-comms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BulkCommsController {
  constructor(private bulk: BulkCommsService) {}

  @Get('opt-out')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  getOptOut(@CurrentUser() user: AuthUser) {
    return this.bulk.getOptOut(user);
  }

  @Patch('opt-out')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  setOptOut(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(bulkCommsOptOutSchema, body);
    return this.bulk.setOptOut(user, data.optedOut);
  }

  @Get('templates')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  listTemplates(@CurrentUser() user: AuthUser, @Query('companyId') companyId: string) {
    return this.bulk.listTemplates(user, companyId);
  }

  @Post('templates')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  createTemplate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(messageTemplateSchema, body);
    return this.bulk.createTemplate(user, data);
  }

  @Patch('templates/:id')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(messageTemplateUpdateSchema, body);
    return this.bulk.updateTemplate(user, id, data);
  }

  @Delete('templates/:id')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  deleteTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bulk.deleteTemplate(user, id);
  }

  @Get('campaigns')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  listCampaigns(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('jobPostId') jobPostId?: string,
  ) {
    return this.bulk.listCampaigns(user, companyId, jobPostId);
  }

  @Get('campaigns/:id')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  getCampaign(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bulk.getCampaign(user, id);
  }

  @Post('campaigns')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  runCampaign(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(bulkCampaignSchema, body);
    return this.bulk.runCampaign(user, {
      ...data,
      fromStatus: data.fromStatus as ApplicationStatus | undefined,
      toStatus: data.toStatus as ApplicationStatus | undefined,
    });
  }
}
