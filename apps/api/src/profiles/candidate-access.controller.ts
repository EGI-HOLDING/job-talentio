import {
  Body,
  Controller,
  Get,
  NotFoundException,
  ForbiddenException,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SearchRateLimitGuard } from '../rate-limit/search-rate-limit.guard';
import { CandidateAccessService } from './candidate-access.service';

@Controller('profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CandidateAccessController {
  constructor(
    private access: CandidateAccessService,
    private db: PrismaService,
    private storage: StorageService,
  ) {}

  @Get('candidates/:profileId/access')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  async availability(
    @CurrentUser() user: AuthUser,
    @Param('profileId') id: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.access.access(user, await this.access.context(user, companyId), id);
  }

  @Get('candidates/:profileId/database-cv')
  @UseGuards(SearchRateLimitGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  async cv(
    @CurrentUser() user: AuthUser,
    @Param('profileId') id: string,
    @Query('companyId') companyId: string,
    @Res() response: Response,
  ) {
    const context = await this.access.context(user, companyId);
    const profile = await this.access.assertAccess(user, context, id, 'CV');
    let bytes: Buffer;
    try {
      bytes = await this.storage.getObjectBuffer(profile.databaseResume!.fileKey!);
    } catch {
      throw new NotFoundException('CV file unavailable');
    }
    // Storage reads may be slow. Recheck revocation or replacement before returning bytes.
    const current = await this.access.assertAccess(user, context, id, 'CV');
    if (
      current.databaseResumeId !== profile.databaseResumeId ||
      current.databaseResume?.fileKey !== profile.databaseResume?.fileKey
    )
      throw new NotFoundException('CV changed. Refresh and try again.');
    await this.db.auditLog.create({
      data: {
        actorId: user.id,
        action: 'CANDIDATE_DATABASE_CV_DOWNLOAD',
        entityType: 'EmployeeProfile',
        entityId: id,
        metadata: { companyId: context, resumeId: profile.databaseResumeId },
      },
    });
    response.setHeader('Cache-Control', 'private, no-store');
    const extension =
      profile.databaseResume!.fileKey!.match(/\.(pdf|docx|doc)$/i)?.[1].toLowerCase() ?? 'bin';
    const contentTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    response.setHeader('Content-Type', contentTypes[extension] ?? 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="candidate-cv.' + extension + '"',
    );
    response.send(bytes);
  }

  @Get('me/database-cv-permission')
  @Roles('EMPLOYEE')
  async permission(@CurrentUser() user: AuthUser) {
    const profile = await this.db.employeeProfile.findUnique({
      where: { userId: user.id },
      select: { databaseCvEnabled: true, databaseResumeId: true },
    });
    if (!profile) throw new NotFoundException();
    return profile;
  }

  @Patch('me/database-cv-permission')
  @Roles('EMPLOYEE')
  async updatePermission(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseDto(
      z.object({ enabled: z.boolean(), resumeId: z.string().nullable() }),
      body,
    );
    return this.db.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "EmployeeProfile" WHERE "userId"=${user.id} FOR UPDATE`;
      const profile = await db.employeeProfile.findUnique({ where: { userId: user.id } });
      if (!profile) throw new NotFoundException();
      const resume = input.resumeId
        ? await db.resume.findFirst({
            where: {
              id: input.resumeId,
              profileId: profile.id,
              deletedAt: null,
              fileKey: { not: null },
            },
          })
        : null;
      if (input.enabled && !resume)
        throw new ForbiddenException('Choose one of your available CV files');
      await db.employeeProfile.update({
        where: { id: profile.id },
        data: { databaseCvEnabled: input.enabled, databaseResumeId: resume?.id ?? null },
      });
      await db.auditLog.create({
        data: {
          actorId: user.id,
          action: 'DATABASE_CV_PERMISSION',
          entityType: 'EmployeeProfile',
          entityId: profile.id,
          metadata: { enabled: input.enabled, resumeId: resume?.id ?? null },
        },
      });
      return { databaseCvEnabled: input.enabled, databaseResumeId: resume?.id ?? null };
    });
  }
}
