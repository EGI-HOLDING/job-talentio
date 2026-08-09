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
import { companyBrowseSchema, companySchema } from '@job-talentio/shared';
import { CompanyMemberRole } from '@prisma/client';
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
  getBySlug(@Param('slug') slug: string) {
    return this.companies.getBySlug(slug);
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

  @Post(':id/invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  invite(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { email: string; role?: CompanyMemberRole },
  ) {
    return this.companies.invite(user, id, body.email, body.role ?? 'RECRUITER');
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
