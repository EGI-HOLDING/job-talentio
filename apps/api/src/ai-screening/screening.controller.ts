import { Controller, Get, Post, Patch, Body, Param, UploadedFile, UseGuards, UseInterceptors, ForbiddenException, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, type AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { resumeUploadOptions } from '../common/upload';
import { PrismaService } from '../prisma/prisma.service';
import { ScreeningSessions } from './screening-sessions.service';
import { ScreeningHr } from './screening-hr.service';
import { screeningEnabled } from './screening.policy';
import { draftSchema, leaseSchema, answerSchema, questionSchema } from './screening.schemas';
@Controller('ai-screening')
export class ScreeningController {
    constructor(private sessions: ScreeningSessions, private hr: ScreeningHr, private db: PrismaService) { }
    @Get('capabilities')
    capabilities() { return { enabled: screeningEnabled(), mandatory: screeningEnabled(), market: 'id', allPackages: true }; }
    @Post('jobs/:jobId/draft')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    draft(
    @CurrentUser()
    user: AuthUser,
    @Param('jobId')
    jobId: string) { return this.sessions.draft(user, jobId); }
    @Get('sessions/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    state(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string) { return this.sessions.state(user, id); }
    @Patch('sessions/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    save(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    body: unknown) { return this.sessions.save(user, id, parseDto(draftSchema, body)); }
    @Post('sessions/:id/claim')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    claim(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    body: unknown) { return this.sessions.claim(user, id, parseDto(leaseSchema, body).clientId); }
    @Post('sessions/:id/start')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    start(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    body: unknown) { return this.sessions.start(user, id, parseDto(leaseSchema, body).clientId); }
    @Post('sessions/:id/shown')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    shown(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    body: unknown) { const d = parseDto(questionSchema, body); return this.sessions.shown(user, id, d.clientId, d.questionId); }
    @Patch('sessions/:id/answer')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    autosave(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    body: unknown) { const d = parseDto(answerSchema, body); return this.sessions.answer(user, id, d.clientId, d.questionId, d.answer, false); }
    @Post('sessions/:id/answer')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    answer(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    body: unknown) { const d = parseDto(answerSchema, body); return this.sessions.answer(user, id, d.clientId, d.questionId, d.answer, true); }
    @Post('sessions/:id/retry')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    retry(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string) { return this.sessions.retry(user, id); }
    @Post('sessions/:id/cover-letter')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    @UseInterceptors(FileInterceptor('file', resumeUploadOptions))
    uploadCover(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @UploadedFile()
    file: Express.Multer.File) { return this.sessions.uploadCover(user, id, file); }
    @Get('sessions/:id/cover-letter')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('EMPLOYEE', 'SUPER_ADMIN')
    cover(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string) { return this.sessions.coverUrl(user, id); }
    @Get('companies/:id/document')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('RECRUITER', 'SUPER_ADMIN')
    company(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string) { return this.sessions.companyDocument(user, id); }
    @Post('companies/:id/document')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('RECRUITER', 'SUPER_ADMIN')
    @UseInterceptors(FileInterceptor('file', resumeUploadOptions))
    uploadCompany(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @UploadedFile()
    file: Express.Multer.File) { return this.sessions.uploadCompany(user, id, file); }
    @Get('applications/:id/assessment')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('RECRUITER', 'SUPER_ADMIN')
    assessment(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string) { return this.hr.assessment(user, id); }
    @Get('applications/:id/report')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('RECRUITER', 'SUPER_ADMIN')
    report(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string) { return this.hr.pdf(user, id); }
    @Get('applications/:id/cover-letter')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('RECRUITER', 'SUPER_ADMIN')
    hrCover(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string) { return this.hr.cover(user, id); }
    @Get('operations')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('SUPER_ADMIN')
    async operations() {
        return { failed: await this.db.aiScreeningWork.findMany({ where: { status: 'FAILED' }, take: 50, orderBy: { updatedAt: 'desc' }, select: { id: true, kind: true, subjectId: true, error: true, updatedAt: true } }),
            uncertain: await this.db.aiScreeningCall.findMany({ where: { status: 'UNCERTAIN' }, take: 50, select: { id: true, workId: true, responseId: true, createdAt: true } }) };
    }
    @Post('operations/:id/retry')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('SUPER_ADMIN')
    async recover(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    body: unknown) {
        const d = parseDto(z.object({ acknowledgePossibleCharge: z.literal(true), reason: z.string().min(10).max(300) }).strict(), body);
        const work = await this.db.aiScreeningWork.findUniqueOrThrow({ where: { id } });
        if (work.status !== 'FAILED')
            throw new BadRequestException('Only failed work can be recovered.');
        await this.db.$transaction(async (tx) => {
            // An operator verifies provider billing before explicitly allowing a new attempt.
            await tx.aiScreeningCall.updateMany({ where: { workId: id, status: { in: ['FAILED', 'INVALID', 'UNCERTAIN'] } }, data: { status: 'RECOVERED' } });
            await tx.aiScreeningWork.update({ where: { id }, data: { status: 'PENDING', attempts: 0, availableAt: new Date(), error: null } });
            await tx.auditLog.create({ data: { actorId: user.id, action: 'TARA_RECOVERY_RETRY', entityType: 'AiScreeningWork', entityId: id, metadata: { reason: d.reason, acknowledgePossibleCharge: true } } });
        });
        return { ok: true };
    }
}
