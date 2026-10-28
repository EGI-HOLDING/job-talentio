import {
  BadRequestException,
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
import { CatalogI18nStatus } from '@prisma/client';
import {
  adminAuditListSchema,
  adminBanSchema,
  adminBulkBanSchema,
  adminBulkCatalogStatusSchema,
  adminBulkIdsSchema,
  adminBulkJobStatusSchema,
  adminBulkResolveSchema,
  adminCatalogBrowseSchema,
  adminCatalogAliasSchema,
  adminCatalogCreateSchema,
  adminCatalogListSchema,
  adminCatalogUpdateSchema,
  adminCompanyListSchema,
  adminFeatureFlagSchema,
  adminInviteOperatorSchema,
  adminJobListSchema,
  adminReportListSchema,
  jobStatusSchema,
  reportResolutionSchema,
  adminUserAnonymizeSchema,
  adminUserListSchema,
  adminVerificationDecisionSchema,
  adminVerificationListSchema,
} from '@job-talentio/shared';
import { AdminService } from './admin.service';
import { AdminVerificationService } from './admin-verification.service';
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
    private verificationQueue: AdminVerificationService,
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

  @Post('users/selected')
  selectedUsers(@Body() body: unknown) {
    const data = parseDto(adminBulkIdsSchema, body);
    return this.lists.selectedUsers(data.ids);
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
    @Body() body: unknown,
  ) {
    const data = parseDto(adminBanSchema, body);
    return this.accounts.banUser(user.id, id, data.banned);
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

  @Post('companies/selected')
  selectedCompanies(@Body() body: unknown) {
    const data = parseDto(adminBulkIdsSchema, body);
    return this.lists.selectedCompanies(data.ids);
  }

  @Post('companies/bulk/ban')
  bulkBanCompanies(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(adminBulkBanSchema, body);
    return this.bulk.banCompanies(user.id, data.ids, data.banned);
  }

  @Post('companies/:id/ban')
  banCompany(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(adminBanSchema, body);
    return this.admin.banCompany(user.id, id, data.banned);
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

  @Post('jobs/selected')
  selectedJobs(@Body() body: unknown) {
    const data = parseDto(adminBulkIdsSchema, body);
    return this.lists.selectedJobs(data.ids);
  }

  @Post('jobs/bulk/status')
  bulkJobStatus(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(adminBulkJobStatusSchema, body);
    return this.bulk.setJobStatuses(user, data.ids, data.status);
  }

  @Post('jobs/:id/status')
  jobStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(jobStatusSchema, body);
    return this.admin.forceJobStatus(user, id, data.status);
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

  @Post('reports/selected')
  selectedReports(@Body() body: unknown) {
    const data = parseDto(adminBulkIdsSchema, body);
    return this.lists.selectedReports(data.ids);
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
    @Body() body: unknown,
  ) {
    const data = parseDto(reportResolutionSchema, body);
    return this.admin.resolveReport(user.id, id, data.status, data.resolution);
  }

  // ─── Company verification queue ───────────────────────────
  @Get('verifications')
  verifications(@Query() query: unknown) {
    return this.verificationQueue.list(parseDto(adminVerificationListSchema, query));
  }

  @Post('verifications/:id/decide')
  decideVerification(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const data = parseDto(adminVerificationDecisionSchema, body);
    return this.verificationQueue.decide(user.id, id, data.status, data.reviewNote);
  }

  // ─── Feature flags and audit ──────────────────────────────

  @Get('flags')
  flags() {
    return this.admin.listFlags();
  }

  @Post('flags')
  upsertFlag(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(adminFeatureFlagSchema, body);
    return this.admin.upsertFlag(user.id, data.key, data.enabled, data.payload);
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

  @Post('catalog/i18n/:kind/selected')
  selectedCatalogI18n(@Param('kind') kind: string, @Body() body: unknown) {
    const data = parseDto(adminBulkIdsSchema, body);
    return this.admin.selectedCatalogI18n(assertCatalogKind(kind), data.ids);
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

  @Get('catalog/type/:type/:id/aliases')
  listCatalogAliases(@Param('type') type: string, @Param('id') id: string) {
    return this.catalog.listAliases(type === 'city' ? 'city' : assertCatalogKind(type), id);
  }

  @Post('catalog/type/:type/:id/aliases')
  createCatalogAlias(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const kind = type === 'city' ? 'city' : assertCatalogKind(type);
    const data = parseDto(adminCatalogAliasSchema, body);
    return this.admin.auditCatalogWrite(user.id, kind, 'CREATE_CATALOG_ALIAS', () =>
      this.catalog.addAlias(kind, id, data.alias),
      id,
    );
  }

  @Delete('catalog/type/:type/:id/aliases/:aliasId')
  deleteCatalogAlias(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Param('aliasId') aliasId: string,
  ) {
    const kind = type === 'city' ? 'city' : assertCatalogKind(type);
    return this.admin.auditCatalogWrite(user.id, kind, 'DELETE_CATALOG_ALIAS', () =>
      this.catalog.removeAlias(kind, id, aliasId),
      id,
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
    @Body() body: { name?: string; nameUz?: string | null; nameRu?: string | null; nameId?: string | null },
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
