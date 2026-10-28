import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AuthUser,
  CurrentUser,
  JwtAuthGuard,
  OptionalJwtAuthGuard,
  Roles,
  RolesGuard,
} from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { SearchRateLimitGuard } from '../rate-limit/search-rate-limit.guard';
import { HrEventsService } from './hr-events.service';
import { HrAnalyticsService } from './hr-analytics.service';
import { HrSupportService } from './hr-support.service';
import { BenefitsService } from './benefits.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('hr-events')
export class HrEventsController {
  constructor(private events: HrEventsService) {}
  @Post()
  @UseGuards(OptionalJwtAuthGuard, SearchRateLimitGuard)
  track(@Body() body: unknown, @CurrentUser() user: AuthUser | undefined, @Req() request: Request) {
    const input = parseDto(
      z.object({
        jobId: z.string().min(1).max(100),
        visitor: z.string().uuid(),
        kind: z.enum(['IMPRESSION', 'DETAIL_VIEW', 'APPLY_CLICK', 'APPLY_START']),
        source: z
          .string()
          .regex(/^[a-zA-Z0-9:_-]{1,40}$/)
          .optional(),
      }),
      body,
    );
    return this.events.track(input, user, request.get('user-agent'));
  }
}
@Controller('hr-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('RECRUITER', 'SUPER_ADMIN')
export class HrReportsController {
  constructor(private reports: HrAnalyticsService) {}
  private input(query: unknown) {
    return parseDto(
      z
        .object({
          companyId: z.string().min(1),
          jobId: z.string().optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
        })
        .refine((v) => !v.from || !v.to || v.from <= v.to, 'Invalid date range'),
      query,
    );
  }
  @Get()
  summary(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const data = this.input(query);
    return this.reports.summary(user, data.companyId, data.jobId, data.from, data.to);
  }
  @Get('csv')
  async csv(@CurrentUser() user: AuthUser, @Query() query: unknown, @Res() response: Response) {
    const data = this.input(query);
    const csv = await this.reports.csv(user, data.companyId, data.jobId, data.from, data.to);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="recruitment-report.csv"');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(csv);
  }
}
@Controller('hr-support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('RECRUITER', 'SUPER_ADMIN')
export class HrSupportController {
  constructor(private support: HrSupportService) {}
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('page') page?: string,
    @Query('status') status?: string,
  ) {
    return this.support.list(
      user,
      companyId,
      parseDto(z.coerce.number().int().min(1).default(1), page),
      parseDto(z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_HR', 'RESOLVED', 'ALL']).optional(), status),
    );
  }
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.support.create(
      user,
      parseDto(
        z.object({
          companyId: z.string().min(1),
          jobId: z.string().optional(),
          title: z.string().trim().min(5).max(180),
          body: z.string().trim().min(10).max(10000),
        }),
        body,
      ),
      key,
    );
  }
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('page') page?: string) {
    return this.support.get(user, id, parseDto(z.coerce.number().int().min(1).default(1), page));
  }
  @Post(':id/replies')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.support.reply(
      user,
      id,
      parseDto(z.object({ body: z.string().trim().min(1).max(10000) }), body).body,
      key,
    );
  }
  @Patch(':id')
  @Roles('SUPER_ADMIN')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.support.update(
      user,
      id,
      parseDto(
        z.object({
          status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_HR', 'RESOLVED']),
          assignedToId: z.string().nullable().optional(),
        }),
        body,
      ),
    );
  }
  @Post(':id/assign-self')
  @Roles('SUPER_ADMIN')
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.update(user, id, { status: 'IN_PROGRESS', assignedToId: user.id });
  }
}
@Controller('benefits/featured')
export class FeaturedController {
  constructor(
    private db: PrismaService,
    private benefits: BenefitsService,
  ) {}
  @Get()
  async list() {
    if (
      !(await this.benefits.enabled('hr_packages')) ||
      !(await this.benefits.enabled('hr_promotions'))
    )
      return [];
    const companies = await this.db.companyPromotion.findMany({
      where: {
        endsAt: { gt: new Date() },
        company: {
          isBanned: false,
          anonymizedAt: null,
          jobPosts: { some: { isAnonymous: false, publishedAt: { not: null } } },
        },
      },
      select: {
        company: { select: { id: true, name: true, slug: true, logoUrl: true, isVerified: true } },
      },
      orderBy: { companyId: 'asc' },
    });
    if (!companies.length) return [];
    const offset = Math.floor(Date.now() / 900000) % companies.length;
    return [...companies.slice(offset), ...companies.slice(0, offset)]
      .slice(0, 6)
      .map((row) => row.company);
  }
}
