import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { applicationStatusSchema, applySchema, interviewSchema } from '@job-talentio/shared';
import { ApplicationsService } from './applications.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';

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
  ) {
    const data = parseDto(applySchema, body ?? {});
    return this.applications.apply(
      user,
      jobId,
      data.coverLetter,
      data.answers,
      data.resumeId,
    );
  }

  @Get('mine')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  mine(@CurrentUser() user: AuthUser) {
    return this.applications.myApplications(user);
  }

  @Get('mine/jobs/:jobId')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  mineForJob(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.applications.getMyApplicationForJob(user, jobId);
  }

  @Get('jobs/:jobId')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  forJob(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('sort') sort?: 'match' | 'newest',
    @Query('minMatch') minMatch?: string,
  ) {
    return this.applications.listForJob(user, jobId, {
      status,
      sort: sort ?? 'match',
      minMatch: minMatch ? Number(minMatch) : undefined,
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
  ) {
    const data = parseDto(interviewSchema, body);
    return this.applications.scheduleInterview(user, id, data);
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
