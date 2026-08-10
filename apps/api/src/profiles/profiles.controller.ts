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
  skillLevelUpdateSchema,
  experienceSchema,
  educationSchema,
  certificationSchema,
  languageSchema,
  languageLevelUpdateSchema,
  resumeSchema,
  resumeImportSchema,
  resumeBuilderSettingsSchema,
  candidateSearchSchema,
} from '@job-talentio/shared';
import { resumeUploadOptions } from '../common/upload';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { SearchRateLimitGuard } from '../rate-limit/search-rate-limit.guard';

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

  @Patch('me/skills/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  updateSkill(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(skillLevelUpdateSchema, body);
    return this.profiles.updateSkillLevel(user, id, data.level);
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

  @Patch('me/experiences/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  updateExp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(experienceSchema.partial(), body);
    return this.profiles.updateExperience(user, id, data);
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

  @Patch('me/educations/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  updateEdu(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(educationSchema.partial(), body);
    return this.profiles.updateEducation(user, id, data);
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

  @Patch('me/certifications/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  updateCert(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(certificationSchema.partial(), body);
    return this.profiles.updateCertification(user, id, data);
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

  @Patch('me/languages/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  updateLang(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(languageLevelUpdateSchema, body);
    return this.profiles.updateLanguageLevel(user, id, data.level);
  }

  @Delete('me/languages/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  removeLang(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.removeLanguage(user, id);
  }

  @Get('me/resume-document')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  resumeDocument(
    @CurrentUser() user: AuthUser,
    @Query('resumeId') resumeId?: string,
  ) {
    return this.profiles.getResumeDocument(user, resumeId);
  }

  @Post('me/resumes')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  createResume(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(resumeSchema, body);
    return this.profiles.createResume(user, data);
  }

  @Post('me/resumes/from-builder')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  createFromBuilder(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(
      resumeBuilderSettingsSchema.extend({
        title: resumeSchema.shape.title,
        jobTitle: resumeSchema.shape.jobTitle,
        jobTitleSlug: resumeSchema.shape.jobTitleSlug,
      }),
      body,
    );
    return this.profiles.createResumeFromBuilder(user, {
      ...data,
      title: data.title as string,
    });
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

  @Patch('me/resumes/:id/builder')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  updateBuilder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = parseDto(resumeBuilderSettingsSchema, body);
    return this.profiles.updateResumeBuilder(user, id, data);
  }

  @Post('me/resumes/:id/export')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  exportResume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.exportResumePdf(user, id);
  }

  @Delete('me/resumes/:id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  deleteResume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.deleteResume(user, id);
  }

  @Post('me/resumes/:id/restore')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  restoreResume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.restoreResume(user, id);
  }

  @Get('me/resumes/:id/download')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  downloadResumeMine(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.downloadResume(user, id);
  }

  /** Owner or recruiter of a company the candidate applied to. */
  @Get('resumes/:id/download')
  @Roles('EMPLOYEE', 'RECRUITER', 'SUPER_ADMIN')
  downloadResume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.downloadResume(user, id);
  }

  @Get('me/resumes/:id/parse-status')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  parseStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.getResumeParseStatus(user, id);
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
    @Body() body: { title?: string; jobTitle?: string; jobTitleSlug?: string; parse?: string | boolean },
  ) {
    const parseRaw = body?.parse;
    const parse =
      parseRaw === true ||
      parseRaw === 'true' ||
      parseRaw === '1' ||
      parseRaw === 'yes';
    return this.profiles.uploadCv(user, file, {
      title: body?.title,
      jobTitle: body?.jobTitle,
      jobTitleSlug: body?.jobTitleSlug,
      parse,
    });
  }

  @Get('candidates')
  @UseGuards(SearchRateLimitGuard)
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
