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
  adminCatalogBrowseSchema,
  adminCatalogCreateSchema,
  adminCatalogListSchema,
  adminCatalogUpdateSchema,
  adminCompanyListSchema,
  adminInviteOperatorSchema,
  adminJobListSchema,
  adminReportListSchema,
  adminUserAnonymizeSchema,
  adminUserListSchema,
} from '@job-talentio/shared';
import { AdminService } from './admin.service';
import { AdminListsService } from './admin-lists.service';
import { AdminBulkService } from './admin-bulk.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminUsersService } from './admin-users.service';
import { isCatalogType } from './catalog-registry';
import type { CatalogType } from './catalog-registry';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { isCatalogKind } from '../common/i18n/catalog-kind';
import type { CatalogKind } from '../common/i18n/catalog-kind';
import { RawLocaleNames } from '../common/locale.interceptor';
import { parseDto } from '../common/utils';

function assertCatalogKind(value: string): CatalogKind {
  if (!isCatalogKind(value)) throw new BadRequestException('Unknown catalog');
  return value;
}

function assertCatalogType(value: string): CatalogType {
  if (!isCatalogType(value)) throw new BadRequestException('Unknown catalog type');
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
    private catalog: AdminCatalogService,
    private accounts: AdminUsersService,
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

  @Post('users')
  inviteOperator(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(adminInviteOperatorSchema, body);
    return this.accounts.inviteOperator(user.id, data);
  }

  @Post('users/:id/send-password-reset')
  sendPasswordReset(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accounts.sendPasswordReset(user.id, id);
  }

  @Post('users/:id/send-verification')
  sendVerification(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accounts.sendVerification(user.id, id);
  }

  @Post('users/:id/revoke-sessions')
  revokeSessions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accounts.revokeSessions(user.id, id);
  }

  @Post('users/:id/anonymize')
  anonymizeUser(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const data = parseDto(adminUserAnonymizeSchema, body);
    return this.accounts.anonymize(user.id, id, data.reason);
  }

  @Post('users/:id/ban')
  banUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { banned: boolean },
  ) {
    return this.accounts.banUser(user.id, id, body.banned);
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

  @Get('catalog/kinds')
  catalogKinds() {
    return this.catalog.kinds();
  }

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

  // ─── Catalog CRUD ─────────────────────────────────────────
  //
  // Covers all ten lookup tables through the registry. Declared after the
  // literal `catalog/...` routes above so those are not captured by `:type`.

  @Get('catalog/type/:type')
  browseCatalog(@Param('type') type: string, @Query() query: unknown) {
    return this.catalog.list(
      assertCatalogType(type),
      parseDto(adminCatalogBrowseSchema, query),
    );
  }

  @Post('catalog/type/:type')
  createCatalogEntry(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Body() body: unknown,
  ) {
    const catalogType = assertCatalogType(type);
    const data = parseDto(adminCatalogCreateSchema, body);
    return this.admin.auditCatalogWrite(user.id, catalogType, 'CREATE_CATALOG_ENTRY', () =>
      this.catalog.create(catalogType, data),
    );
  }

  @Get('catalog/type/:type/:id/usage')
  catalogUsage(@Param('type') type: string, @Param('id') id: string) {
    return this.catalog.usage(assertCatalogType(type), id);
  }

  @Patch('catalog/type/:type/:id')
  updateCatalogRow(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const catalogType = assertCatalogType(type);
    const data = parseDto(adminCatalogUpdateSchema, body);
    return this.admin.auditCatalogWrite(
      user.id,
      catalogType,
      'UPDATE_CATALOG_ENTRY',
      () => this.catalog.update(catalogType, id, data),
      id,
    );
  }

  @Post('catalog/type/:type/:id/archive')
  archiveCatalogEntry(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    const catalogType = assertCatalogType(type);
    return this.admin.auditCatalogWrite(
      user.id,
      catalogType,
      'ARCHIVE_CATALOG_ENTRY',
      () => this.catalog.archive(catalogType, id),
      id,
    );
  }

  @Post('catalog/type/:type/:id/restore')
  restoreCatalogEntry(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    const catalogType = assertCatalogType(type);
    return this.admin.auditCatalogWrite(
      user.id,
      catalogType,
      'RESTORE_CATALOG_ENTRY',
      () => this.catalog.restore(catalogType, id),
      id,
    );
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
