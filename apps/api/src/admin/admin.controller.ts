import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CatalogI18nStatus, JobStatus, PlanCode } from '@prisma/client';
import { AdminService } from './admin.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { isCatalogKind } from '../common/i18n/catalog-kind';
import type { CatalogKind } from '../common/i18n/catalog-kind';
import { RawLocaleNames } from '../common/locale.interceptor';

function assertCatalogKind(value: string): CatalogKind {
  if (!isCatalogKind(value)) throw new BadRequestException('Unknown catalog');
  return value;
}

function assertStatus(value?: string): CatalogI18nStatus | undefined {
  if (!value) return undefined;
  if (value !== 'PENDING' && value !== 'COMPLETE' && value !== 'IGNORED') {
    throw new BadRequestException('Unknown status');
  }
  return value;
}

// The admin app is English-only and edits the locale columns directly, so its
// responses keep nameUz / nameRu instead of being collapsed into `name`.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@RawLocaleNames()
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

  @Get('catalog/i18n')
  catalogQueue(
    @Query('kind') kind = 'skill',
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
  ) {
    return this.admin.listCatalogI18n({
      kind: assertCatalogKind(kind),
      status: assertStatus(status),
      q,
      page: page ? Number(page) : 1,
    });
  }

  @Get('catalog/i18n/summary')
  catalogSummary() {
    return this.admin.catalogI18nSummary();
  }

  @Patch('catalog/:kind/:id')
  updateCatalogEntry(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { name?: string; nameUz?: string | null; nameRu?: string | null },
  ) {
    return this.admin.updateCatalogEntry(user.id, assertCatalogKind(kind), id, body);
  }

  @Post('catalog/:kind/:id/translate')
  translateCatalogEntry(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    return this.admin.translateCatalogEntry(user.id, assertCatalogKind(kind), id);
  }

  @Post('catalog/:kind/:id/status')
  setCatalogStatus(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const status = assertStatus(body.status);
    if (!status) throw new BadRequestException('status required');
    return this.admin.setCatalogStatus(user.id, assertCatalogKind(kind), id, status);
  }

  @Post('catalog/:kind/:id/merge')
  mergeCatalogEntry(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: { targetId: string },
  ) {
    if (!body?.targetId) throw new BadRequestException('targetId required');
    return this.admin.mergeCatalogEntry(user.id, assertCatalogKind(kind), id, body.targetId);
  }

  @Post('catalog/:kind/reclassify')
  reclassifyCatalog(@CurrentUser() user: AuthUser, @Param('kind') kind: string) {
    return this.admin.reclassifyCatalog(user.id, assertCatalogKind(kind));
  }
}
