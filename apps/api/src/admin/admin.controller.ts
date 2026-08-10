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
import {
  adminAuditListSchema,
  adminBulkBanSchema,
  adminBulkCatalogStatusSchema,
  adminBulkHotSchema,
  adminBulkIdsSchema,
  adminBulkJobStatusSchema,
  adminBulkPlanSchema,
  adminBulkResolveSchema,
  adminCatalogListSchema,
  adminCompanyListSchema,
  adminJobListSchema,
  adminReportListSchema,
  adminUserListSchema,
} from '@job-talentio/shared';
import { AdminService } from './admin.service';
import { AdminListsService } from './admin-lists.service';
import { AdminBulkService } from './admin-bulk.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { isCatalogKind } from '../common/i18n/catalog-kind';
import type { CatalogKind } from '../common/i18n/catalog-kind';
import { RawLocaleNames } from '../common/locale.interceptor';
import { parseDto } from '../common/utils';

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

/**
 * Route order matters: Nest matches in declaration order, so every literal path
 * ("users/bulk/ban", "users/ids") is declared before the `:id` variants.
 * Otherwise `:id` swallows the literal and "bulk" is treated as a record id.
 *
 * The admin app is English-only and edits the locale columns directly, so its
 * responses keep nameUz / nameRu instead of being collapsed into `name`.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@RawLocaleNames()
export class AdminController {
  constructor(
    private admin: AdminService,
    private lists: AdminListsService,
    private bulk: AdminBulkService,
  ) {}

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  // ─── Users ────────────────────────────────────────────────

  @Get('users')
  users(@Query() query: unknown) {
    return this.lists.listUsers(parseDto(adminUserListSchema, query));
  }

  @Get('users/ids')
  userIds(@Query() query: unknown) {
    return this.lists.userIds(parseDto(adminUserListSchema, query));
  }

  @Post('users/bulk/ban')
  bulkBanUsers(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(adminBulkBanSchema, body);
    return this.bulk.banUsers(user.id, data.ids, data.banned);
  }

  @Post('users/:id/ban')
  banUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { banned: boolean },
  ) {
    return this.admin.banUser(user.id, id, body.banned);
  }

  // ─── Companies ────────────────────────────────────────────

  @Get('companies')
  companies(@Query() query: unknown) {
    return this.lists.listCompanies(parseDto(adminCompanyListSchema, query));
  }

  @Get('companies/ids')
  companyIds(@Query() query: unknown) {
    return this.lists.companyIds(parseDto(adminCompanyListSchema, query));
  }

  @Post('companies/bulk/ban')
  bulkBanCompanies(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(adminBulkBanSchema, body);
    return this.bulk.banCompanies(user.id, data.ids, data.banned);
  }

  @Post('companies/bulk/plan')
  bulkSetPlan(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(adminBulkPlanSchema, body);
    return this.bulk.setCompanyPlans(user.id, data.ids, data.plan);
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

  // ─── Jobs ─────────────────────────────────────────────────

  @Get('jobs')
  jobs(@Query() query: unknown) {
    return this.lists.listJobs(parseDto(adminJobListSchema, query));
  }

  @Get('jobs/ids')
  jobIds(@Query() query: unknown) {
    return this.lists.jobIds(parseDto(adminJobListSchema, query));
  }

  @Post('jobs/bulk/status')
  bulkJobStatus(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(adminBulkJobStatusSchema, body);
    return this.bulk.setJobStatuses(user.id, data.ids, data.status);
  }

  @Post('jobs/bulk/hot')
  bulkHotJobs(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(adminBulkHotSchema, body);
    return this.bulk.boostJobs(user.id, data.ids, data.days);
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

  // ─── Reports ──────────────────────────────────────────────

  @Get('reports')
  reports(@Query() query: unknown) {
    return this.lists.listReports(parseDto(adminReportListSchema, query));
  }

  @Get('reports/ids')
  reportIds(@Query() query: unknown) {
    return this.lists.reportIds(parseDto(adminReportListSchema, query));
  }

  @Post('reports/bulk/resolve')
  bulkResolveReports(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(adminBulkResolveSchema, body);
    return this.bulk.resolveReports(user.id, data.ids, data.status, data.resolution);
  }

  @Post('reports/:id/resolve')
  resolveReport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { status: 'RESOLVED' | 'DISMISSED'; resolution?: string },
  ) {
    return this.admin.resolveReport(user.id, id, body.status, body.resolution);
  }

  // ─── Feature flags and audit ──────────────────────────────

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
  audit(@Query() query: unknown) {
    return this.lists.listAuditLogs(parseDto(adminAuditListSchema, query));
  }

  @Get('audit-logs/facets')
  auditFacets() {
    return this.lists.auditFacets();
  }

  // ─── Catalog translations ─────────────────────────────────

  @Get('catalog/i18n')
  catalogQueue(@Query() query: unknown) {
    return this.admin.listCatalogI18n(parseDto(adminCatalogListSchema, query));
  }

  @Get('catalog/i18n/ids')
  catalogIds(@Query() query: unknown) {
    return this.admin.catalogI18nIds(parseDto(adminCatalogListSchema, query));
  }

  @Get('catalog/i18n/summary')
  catalogSummary() {
    return this.admin.catalogI18nSummary();
  }

  @Post('catalog/:kind/bulk/status')
  bulkCatalogStatus(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(adminBulkCatalogStatusSchema, body);
    return this.bulk.setCatalogStatuses(user.id, assertCatalogKind(kind), data.ids, data.status);
  }

  @Post('catalog/:kind/bulk/translate')
  bulkCatalogTranslate(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(adminBulkIdsSchema, body);
    return this.bulk.translateCatalog(user.id, assertCatalogKind(kind), data.ids);
  }

  @Post('catalog/:kind/reclassify')
  reclassifyCatalog(@CurrentUser() user: AuthUser, @Param('kind') kind: string) {
    return this.admin.reclassifyCatalog(user.id, assertCatalogKind(kind));
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
}
