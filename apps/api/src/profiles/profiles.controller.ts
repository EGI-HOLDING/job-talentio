import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  profileUpdateSchema,
  skillSchema,
  experienceSchema,
  educationSchema,
  certificationSchema,
  languageSchema,
  resumeSchema,
  resumeImportSchema,
  candidateSearchSchema,
} from '@job-talentio/shared';
import { resumeUploadOptions } from '../common/upload';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';

@Controller('profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProfilesController {
  constructor(private profiles: ProfilesService) {}

  @Get('me')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  me(@CurrentUser() user: AuthUser) {
    return this.profiles.myProfile(user);
  }

  @Patch('me')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(profileUpdateSchema, body);
    return this.profiles.updateProfile(user, data);
  }

  @Post('me/skills')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  addSkill(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(skillSchema, body);
    return this.profiles.addSkill(user, data);
  }

  @Delete('me/skills/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  removeSkill(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.removeSkill(user, id);
  }

  @Post('me/experiences')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  addExp(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(experienceSchema, body);
    return this.profiles.addExperience(user, data);
  }

  @Delete('me/experiences/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  removeExp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.removeExperience(user, id);
  }

  @Post('me/educations')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  addEdu(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(educationSchema, body);
    return this.profiles.addEducation(user, data);
  }

  @Delete('me/educations/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  removeEdu(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.removeEducation(user, id);
  }

  @Post('me/certifications')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  addCert(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(certificationSchema, body);
    return this.profiles.addCertification(user, data);
  }

  @Delete('me/certifications/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  removeCert(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.removeCertification(user, id);
  }

  @Post('me/languages')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  addLang(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(languageSchema, body);
    return this.profiles.addLanguage(user, data);
  }

  @Delete('me/languages/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  removeLang(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.removeLanguage(user, id);
  }

  @Post('me/resumes')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  createResume(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(resumeSchema, body);
    return this.profiles.createResume(user, data);
  }

  @Patch('me/resumes/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  updateResume(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(resumeSchema.partial(), body);
    return this.profiles.updateResume(user, id, data);
  }

  @Delete('me/resumes/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  deleteResume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.deleteResume(user, id);
  }

  @Get('me/resumes/:id/download')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  downloadResume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.downloadResume(user, id);
  }

  @Post('me/resumes/:id/file')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  @UseInterceptors(FileInterceptor('file', resumeUploadOptions))
  attachFile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.profiles.attachFileToResume(user, id, file);
  }

  @Post('me/resumes/:id/import')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  importParsed(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const data = parseDto(resumeImportSchema, body);
    return this.profiles.importParsedResume(user, id, data);
  }

  @Post('me/resumes/upload')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  @UseInterceptors(FileInterceptor('file', resumeUploadOptions))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.profiles.uploadCv(user, file);
  }

  @Get('candidates')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  candidates(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const data = parseDto(candidateSearchSchema, query);
    return this.profiles.searchCandidates(user, {
      ...data,
      hasCertification: Boolean(data.hasCertification),
      skillMode: data.skillMode ?? 'OR',
      sort: data.sort ?? 'relevance',
      page: data.page ?? 1,
      limit: data.limit ?? 12,
    });
  }

  @Get('candidates/:id')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  candidateDetail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('matchJobId') matchJobId?: string,
  ) {
    return this.profiles.getCandidateProfile(user, id, matchJobId);
  }

  @Post('me/saved-jobs/:jobId')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  save(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.profiles.saveJob(user, jobId);
  }

  @Delete('me/saved-jobs/:jobId')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  unsave(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.profiles.unsaveJob(user, jobId);
  }

  @Get('me/saved-jobs')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  saved(@CurrentUser() user: AuthUser) {
    return this.profiles.listSaved(user);
  }
}
