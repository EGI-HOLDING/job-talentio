import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { employeeEvidencePatchSchema } from '@job-talentio/shared';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard, type AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { EmployeeEvidenceService } from './employee-evidence.service';
@Controller('profiles/me/resumes/:resumeId/versions/:versionId/matching-evidence')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('EMPLOYEE')
export class EmployeeEvidenceController {
    constructor(private evidence: EmployeeEvidenceService) { }
    @Get()
    get(
    @CurrentUser()
    user: AuthUser, 
    @Param('resumeId')
    resumeId: string, 
    @Param('versionId')
    versionId: string) { return this.evidence.get(user.id, resumeId, versionId); }
    @Post()
    prepare(
    @CurrentUser()
    user: AuthUser, 
    @Param('resumeId')
    resumeId: string, 
    @Param('versionId')
    versionId: string) { return this.evidence.prepare(user.id, resumeId, versionId); }
    @Patch()
    patch(
    @CurrentUser()
    user: AuthUser, 
    @Param('resumeId')
    resumeId: string, 
    @Param('versionId')
    versionId: string, 
    @Body()
    body: unknown) { return this.evidence.patch(user.id, resumeId, versionId, parseDto(employeeEvidencePatchSchema, body)); }
}
