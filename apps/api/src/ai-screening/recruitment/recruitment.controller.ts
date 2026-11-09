import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { parseDto } from '../../common/utils';
import { RecruitmentService } from './recruitment.service';
import { candidateBulkSchema, candidateImportSchema, candidateListSchema } from './recruitment.schemas';
@Controller('recruitment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('RECRUITER','SUPER_ADMIN')
export class RecruitmentController {
  constructor(private candidates: RecruitmentService) {}
  @Get('companies/:id/members') members(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.candidates.members(user,id); }
  @Get('companies/:id/jobs') jobs(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.candidates.jobs(user,id); }
  @Post('imports') createImport(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.candidates.createImport(user, parseDto(candidateImportSchema, body)); }
  @Post('candidates/bulk') bulk(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.candidates.bulk(user, parseDto(candidateBulkSchema, body)); }
  @Get('imports/:id') importState(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.candidates.importState(user, id); }
  @Post('candidates/:id/upload-complete') complete(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.candidates.completeUpload(user, id); }
  @Post('candidates/:id/upload-url') uploadUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.candidates.uploadUrl(user, id); }
  @Get('candidates') list(@CurrentUser() user: AuthUser, @Query() query: unknown) { return this.candidates.list(user, parseDto(candidateListSchema, query)); }
  @Get('candidates/:id') detail(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.candidates.detail(user, id); }
  @Get('jobs/:jobId/applications/:applicationId/candidate') applicationCandidate(@CurrentUser() user:AuthUser,@Param('jobId') jobId:string,@Param('applicationId') applicationId:string){return this.candidates.applicationCandidate(user,jobId,applicationId);}
  @Get('candidates/:id/cv') download(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.candidates.download(user, id); }
  @Post('candidates/:id/retry') retry(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.candidates.retry(user, id); }
}
