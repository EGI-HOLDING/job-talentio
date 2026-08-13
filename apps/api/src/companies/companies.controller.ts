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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  companyBrowseSchema,
  companySchema,
  companyTranslationSchema,
  companyInviteSchema,
} from '@job-talentio/shared';
import { CompaniesService } from './companies.service';
import {
  JwtAuthGuard,
  Roles,
  RolesGuard,
  CurrentUser,
  AuthUser,
  OptionalJwtAuthGuard,
} from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { imageUploadOptions } from '../common/upload';
import { requestLocale } from '../common/i18n/request-locale';
import { isLocale } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';
import { SearchRateLimitGuard } from '../rate-limit/search-rate-limit.guard';

function assertLocale(value: string): Locale {
  if (!isLocale(value)) throw new BadRequestException('Unsupported locale');
  return value;
}

@Controller('companies')
export class CompaniesController {
  constructor(private companies: CompaniesService) {}

  /** Public hiring directory - must stay before :id routes. */
  @Get()
  browse(@Query() query: unknown) {
    const data = parseDto(companyBrowseSchema, query);
    return this.companies.browse({
      q: data.q,
      industrySlug: data.industrySlug,
      plan: data.plan,
      sort: data.sort ?? 'jobs',
      page: data.page ?? 1,
      limit: data.limit ?? 24,
    });
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  mine(@CurrentUser() user: AuthUser) {
    return this.companies.myCompanies(user.id);
  }

  @Get('slug/:slug')
  getBySlug(@Param('slug') slug: string, @Req() req: Request) {
    return this.companies.getBySlug(slug, requestLocale(req));
  }

  @Get('invites/:token')
  previewInvite(@Param('token') token: string) {
    return this.companies.previewInvite(token);
  }

  /** Signed-in and rate limited: every miss costs money at the provider. */
  @Post('slug/:slug/translate/:locale')
  @UseGuards(JwtAuthGuard, SearchRateLimitGuard)
  machineTranslate(@Param('slug') slug: string, @Param('locale') locale: string) {
    return this.companies.machineTranslate(slug, assertLocale(locale));
  }

  @Get(':id/translations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  listTranslations(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companies.listTranslations(user, id);
  }

  @Patch(':id/translations/:locale')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  upsertTranslation(
    @Param('id') id: string,
    @Param('locale') locale: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(companyTranslationSchema, body);
    return this.companies.upsertTranslation(user, id, assertLocale(locale), data.description);
  }

  @Delete(':id/translations/:locale')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  deleteTranslation(
    @Param('id') id: string,
    @Param('locale') locale: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companies.deleteTranslation(user, id, assertLocale(locale));
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companies.assertMember(user, id).then(() => this.companies.get(id));
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(companySchema.partial(), body);
    return this.companies.update(user, id, data);
  }

  @Post(':id/logo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  uploadLogo(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.companies.uploadLogo(user, id, file);
  }

  @Delete(':id/logo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  clearLogo(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companies.clearLogo(user, id);
  }

  @Post(':id/invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  invite(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(companyInviteSchema, body);
    return this.companies.invite(user, id, data.email, data.role);
  }

  @Get(':id/invites')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  listInvites(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companies.listPendingInvites(user, id);
  }

  @Delete(':id/invites/:inviteId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  revokeInvite(
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companies.revokeInvite(user, id, inviteId);
  }

  @Delete(':id/members/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companies.removeMember(user, id, userId);
  }

  @Post(':id/follow')
  @UseGuards(JwtAuthGuard)
  follow(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companies.follow(user, id);
  }

  @Delete(':id/follow')
  @UseGuards(JwtAuthGuard)
  unfollow(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companies.unfollow(user, id);
  }

  @Get(':id/following')
  @UseGuards(OptionalJwtAuthGuard)
  following(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    if (!user) return { following: false };
    return this.companies.isFollowing(user.id, id);
  }
}
