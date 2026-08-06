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
  jobPostSchema,
  jobSearchSchema,
  hotJobSchema,
  jobQuestionSchema,
} from '@job-talentio/shared';
import { JobStatus } from '@prisma/client';
import { JobsService } from './jobs.service';
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

@Controller('jobs')
export class JobsController {
  constructor(
    private jobs: JobsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async search(@Query() query: unknown, @CurrentUser() user?: AuthUser) {
    const data = parseDto(jobSearchSchema, query);
    let profileId: string | undefined;
    if (user?.role === 'EMPLOYEE') {
      const profile = await this.prisma.employeeProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      profileId = profile?.id;
    }
    return this.jobs.search({
      ...data,
      hotOnly: Boolean(data.hotOnly),
      skillMode: data.skillMode ?? 'OR',
      sort: data.sort ?? 'relevance',
      page: data.page ?? 1,
      limit: data.limit ?? 12,
      profileId,
    });
  }

  @Get('suggest')
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
  get(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.jobs.get(id, user?.id);
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
  listQuestions(@Param('id') id: string) {
    return this.jobs.listQuestions(id);
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
  hot(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(hotJobSchema, body);
    return this.jobs.activateHotJob(user, id, data.days);
  }
}
