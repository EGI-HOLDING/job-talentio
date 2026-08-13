import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  jobPostSchema,
  jobSearchSchema,
  jobQuestionSchema,
  jobTranslationSchema,
} from '@job-talentio/shared';
import { JobStatus } from '@prisma/client';
import { JobsService } from './jobs.service';
import { requestLocale } from '../common/i18n/request-locale';
import { isLocale } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';
import {
  JwtAuthGuard,
  Roles,
  RolesGuard,
  CurrentUser,
  AuthUser,
  OptionalJwtAuthGuard,
} from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { PrismaService } from '../prisma/prisma.service';
import { SearchRateLimitGuard } from '../rate-limit/search-rate-limit.guard';

function assertLocale(value: string): Locale {
  if (!isLocale(value)) throw new BadRequestException('Unsupported locale');
  return value;
}

@Controller('jobs')
export class JobsController {
  constructor(
    private jobs: JobsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  @UseGuards(SearchRateLimitGuard, OptionalJwtAuthGuard)
  async search(
    @Query() query: unknown,
    @Req() req: Request,
    @CurrentUser() user?: AuthUser,
  ) {
    const data = parseDto(jobSearchSchema, query);
    let profileId: string | undefined;
    if (user?.role === 'EMPLOYEE') {
      const profile = await this.prisma.employeeProfile.findUnique({
        where: { userId: user.id },
        select: {
          id: true,
          _count: { select: { skills: true } },
        },
      });
      // Empty profiles must not drive sort=match or match rings (baseline scores are misleading).
      if (profile && profile._count.skills > 0) {
        profileId = profile.id;
      }
    }
    const sort =
      data.sort === 'match' && !profileId ? 'relevance' : (data.sort ?? 'relevance');
    return this.jobs.search({
      ...data,
      hotOnly: Boolean(data.hotOnly),
      skillMode: data.skillMode ?? 'OR',
      sort,
      page: data.page ?? 1,
      limit: data.limit ?? 12,
      profileId,
      locale: requestLocale(req),
    });
  }

  @Get('suggest')
  @UseGuards(SearchRateLimitGuard)
  suggest(@Query('q') q: string) {
    return this.jobs.suggest(q || '');
  }

  @Get('recommended')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  recommended(@CurrentUser() user: AuthUser) {
    return this.jobs.recommendedForUser(user);
  }

  @Get('company/:companyId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  listMine(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.jobs.listMine(user, companyId);
  }

  @Post('company/:companyId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(jobPostSchema, body);
    return this.jobs.create(user, companyId, data);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  get(@Param('id') id: string, @Req() req: Request, @CurrentUser() user?: AuthUser) {
    return this.jobs.get(id, user, requestLocale(req));
  }

  /** Public SEO payload for JSON-LD; unlike GET /jobs/:id it records no JobView. */
  @Get(':id/seo')
  seo(@Param('id') id: string, @Req() req: Request) {
    return this.jobs.getSeo(id, requestLocale(req));
  }

  /**
   * Reader-triggered machine translation, including guests. Rate limited and
   * budgeted: the first miss pays the provider, later readers hit the cache.
   */
  @Post(':id/translate/:locale')
  @UseGuards(OptionalJwtAuthGuard, SearchRateLimitGuard)
  machineTranslate(
    @Param('id') id: string,
    @Param('locale') locale: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.jobs.machineTranslate(id, assertLocale(locale), user);
  }

  @Get(':id/translations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  listTranslations(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.listTranslations(user, id);
  }

  @Put(':id/translations/:locale')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  upsertTranslation(
    @Param('id') id: string,
    @Param('locale') locale: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(jobTranslationSchema, body);
    return this.jobs.upsertTranslation(user, id, assertLocale(locale), data);
  }

  /** Recruiter-triggered MT. Does not record a JobView. */
  @Post(':id/translations/:locale/auto')
  @UseGuards(JwtAuthGuard, RolesGuard, SearchRateLimitGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  autoTranslate(
    @Param('id') id: string,
    @Param('locale') locale: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.autoTranslate(user, id, assertLocale(locale));
  }

  @Delete(':id/translations/:locale')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  deleteTranslation(
    @Param('id') id: string,
    @Param('locale') locale: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.deleteTranslation(user, id, assertLocale(locale));
  }

  @Get(':id/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  stats(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.getStats(user, id);
  }

  @Get(':id/recommended-candidates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  recommendedCandidates(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.recommendedCandidates(user, id);
  }

  @Get(':id/questions')
  @UseGuards(OptionalJwtAuthGuard)
  listQuestions(@Param('id') id: string, @Req() req: Request, @CurrentUser() user?: AuthUser) {
    return this.jobs.listQuestions(id, user, requestLocale(req));
  }

  @Post(':id/questions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  addQuestion(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(jobQuestionSchema, body);
    return this.jobs.addQuestion(user, id, data);
  }

  @Delete(':id/questions/:questionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  removeQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.removeQuestion(user, id, questionId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(jobPostSchema.partial(), body);
    return this.jobs.update(user, id, data);
  }

  @Post(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  status(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { status: JobStatus },
  ) {
    return this.jobs.changeStatus(user, id, body.status);
  }

  @Post(':id/hot')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  hot() {
    // Free boost via this route is disabled — purchase through billing
    throw new BadRequestException(
      'Hot job boosts must be purchased via POST /billing/companies/:companyId/jobs/:jobId/hot',
    );
  }
}
