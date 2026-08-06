import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JobStatus, PlanCode } from '@prisma/client';
import { AdminService } from './admin.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  @Get('users')
  users(@Query('page') page?: string) {
    return this.admin.listUsers(page ? Number(page) : 1);
  }

  @Post('users/:id/ban')
  banUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { banned: boolean },
  ) {
    return this.admin.banUser(user.id, id, body.banned);
  }

  @Get('companies')
  companies(@Query('page') page?: string) {
    return this.admin.listCompanies(page ? Number(page) : 1);
  }

  @Post('companies/:id/ban')
  banCompany(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { banned: boolean },
  ) {
    return this.admin.banCompany(user.id, id, body.banned);
  }

  @Post('companies/:id/plan')
  setPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { plan: PlanCode },
  ) {
    return this.admin.setPlan(user.id, id, body.plan);
  }

  @Get('jobs')
  jobs(@Query('page') page?: string) {
    return this.admin.listJobs(page ? Number(page) : 1);
  }

  @Post('jobs/:id/status')
  jobStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { status: JobStatus },
  ) {
    return this.admin.forceJobStatus(user.id, id, body.status);
  }

  @Post('jobs/:id/hot')
  hotJob(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { days: number },
  ) {
    return this.admin.setHotJob(user.id, id, body.days ?? 7);
  }

  @Get('flags')
  flags() {
    return this.admin.listFlags();
  }

  @Post('flags')
  upsertFlag(
    @CurrentUser() user: AuthUser,
    @Body() body: { key: string; enabled: boolean; payload?: unknown },
  ) {
    return this.admin.upsertFlag(user.id, body.key, body.enabled, body.payload);
  }

  @Get('audit-logs')
  audit(@Query('page') page?: string) {
    return this.admin.auditLogs(page ? Number(page) : 1);
  }

  @Get('reports')
  reports(@Query('page') page?: string) {
    return this.admin.listReports(page ? Number(page) : 1);
  }

  @Post('reports/:id/resolve')
  resolveReport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { status: 'RESOLVED' | 'DISMISSED'; resolution?: string },
  ) {
    return this.admin.resolveReport(user.id, id, body.status, body.resolution);
  }
}
