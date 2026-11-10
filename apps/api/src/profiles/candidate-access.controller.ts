import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
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

  @Get('candidates/:profileId/resumes/:resumeId/download')
  @UseGuards(SearchRateLimitGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  async cv(
    @CurrentUser() user: AuthUser,
    @Param('profileId') profileId: string,
    @Param('resumeId') resumeId: string,
    @Query('companyId') companyId: string,
    @Res() response: Response,
  ) {
    const context = await this.access.context(user, companyId);
    const { resume } = await this.access.resume(user, context, profileId, resumeId);
    let bytes: Buffer;
    try {
      bytes = await this.storage.getObjectBuffer(resume.fileKey!);
    } catch {
      throw new NotFoundException('CV file unavailable');
    }
    // Storage reads may be slow. Recheck membership, account status and file ownership before delivery.
    const current = await this.access.resume(user, context, profileId, resumeId);
    if (current.resume.fileKey !== resume.fileKey)
      throw new NotFoundException('CV changed. Refresh and try again.');
    await this.db.auditLog.create({
      data: {
        actorId: user.id,
        action: 'CANDIDATE_PROFILE_CV_DOWNLOAD',
        entityType: 'EmployeeProfile',
        entityId: profileId,
        metadata: { companyId: context, resumeId },
      },
    });
    response.setHeader('Cache-Control', 'private, no-store');
    const extension =
      resume.fileKey!.match(/\.(pdf|docx|doc)$/i)?.[1].toLowerCase() ?? 'bin';
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
}
