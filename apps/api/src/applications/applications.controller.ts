import { Body, Headers, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { applicantSearchSchema, applicationListSchema, applicationStatusSchema, applySchema, interviewSchema } from '@job-talentio/shared';
import { ApplicationsService } from './applications.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { requestLocale } from '../common/i18n/request-locale';

@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(private applications: ApplicationsService) {}

  @Post('jobs/:jobId')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  apply(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const data = parseDto(applySchema, body ?? {});
    return this.applications.apply(
      user,
      jobId,
      data.coverLetter,
      data.answers,
      data.resumeId,
      data.source,
      requestLocale(req),
      data.funnelSession,
    );
  }

  @Get('mine')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  mine(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.applications.myApplications(user, requestLocale(req));
  }

  @Get('mine/jobs/:jobId')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  mineForJob(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.applications.getMyApplicationForJob(user, jobId);
  }

  @Get('jobs/:jobId/search')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  searchForJob(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser, @Req() req: Request, @Query() query: unknown) {
    return this.applications.searchForJob(user, jobId, parseDto(applicantSearchSchema, query), requestLocale(req));
  }

  @Get('jobs/:jobId/applicants/:applicationId')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  getForJob(@Param('jobId') jobId: string, @Param('applicationId') applicationId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.applications.getForJob(user, jobId, applicationId, requestLocale(req));
  }

  @Get('jobs/:jobId/kanban')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  kanban(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser, @Req() req: Request, @Query() query: unknown) {
    const data = parseDto(applicantSearchSchema.omit({sort:true,minMatch:true}).partial({limit:true}), query);
    return this.applications.kanbanForJob(user, jobId, {...data,limit:Math.min(data.limit ?? 20,50)}, requestLocale(req));
  }

  @Post(':id/kanban')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  addToKanban(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.applications.addToKanban(user,id);
  }

  @Get('jobs/:jobId')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  forJob(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Query() query: unknown,
  ) {
    const data = parseDto(applicationListSchema, query);
    return this.applications.listForJob(user, jobId, {
      ...data,
      locale: requestLocale(req),
    });
  }

  @Post(':id/status')
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(applicationStatusSchema, body);
    return this.applications.updateStatus(user, id, data.status, data.note);
  }

  @Post(':id/rescore')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  rescore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.applications.rescore(user, id);
  }

  @Post(':id/interviews')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  scheduleInterview(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const data = parseDto(interviewSchema, body);
    return this.applications.scheduleInterview(user, id, data, key);
  }

  @Get(':id/interviews')
  listInterviews(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.applications.listInterviews(user, id);
  }

  @Get(':id/resume-download')
  downloadResume(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.applications.downloadResume(user, id);
  }
}
