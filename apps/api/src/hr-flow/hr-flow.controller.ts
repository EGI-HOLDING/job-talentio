import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { jobPostSchema } from '@job-talentio/shared';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { resumeUploadOptions,imageUploadOptions } from '../common/upload';
import { HrFlowService } from './hr-flow.service';
import { hrFlowEnabled } from './hr-flow.policy';

export const creationDraftSchema=jobPostSchema.omit({isAnonymous:true,screeningQuestions:true,categorySlug:true,experienceLevel:true,experienceYearsMin:true,locale:true,jobTitleSlug:true}).partial().extend({
  title:z.string().max(200).optional(),description:z.string().max(20000).optional(),
  responsibilities:z.array(z.string().max(1000)).max(30).optional(),kpis:z.array(z.string().max(1000)).max(30).optional(),
}).strict();
@Controller('hr-flow')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('RECRUITER','SUPER_ADMIN')
export class HrFlowController {
  constructor(private flow:HrFlowService){}
  @Get('capabilities') capabilities(){return {enabled:hrFlowEnabled(),version:2};}
  @Post('sessions') create(@CurrentUser() user:AuthUser,@Body() body:unknown,@Headers('idempotency-key') key?:string){return this.flow.create(user,parseDto(z.object({companyId:z.string().min(1).max(100)}).strict(),body).companyId,key);}
  @Get('sessions') list(@CurrentUser() user:AuthUser,@Query('companyId') companyId:string){return this.flow.list(user,parseDto(z.string().min(1).max(100),companyId));}
  @Get('sessions/:id') get(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.flow.get(user,id);}
  @Patch('sessions/:id') patch(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){return this.flow.patch(user,id,parseDto(z.object({revision:z.number().int().nonnegative(),draft:creationDraftSchema.optional(),phase:z.enum(['PACKAGE','CHECKOUT','JOB']).optional(),packageCode:z.enum(['FREE','STANDARD','PREMIUM']).optional()}).strict(),body));}
  @Post('sessions/:id/publish') publish(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key?:string){return this.flow.publish(user,id,parseDto(z.object({revision:z.number().int().nonnegative()}).strict(),body).revision,key);}
  @Post('documents')
  @UseInterceptors(FileInterceptor('file',resumeUploadOptions))
  upload(@CurrentUser() user:AuthUser,@UploadedFile() file:Express.Multer.File){return this.flow.upload(user,file);}
  @Post('logos')
  @UseInterceptors(FileInterceptor('file',imageUploadOptions))
  logo(@CurrentUser() user:AuthUser,@UploadedFile() file:Express.Multer.File){return this.flow.upload(user,file,'LOGO');}
  @Get('documents/:id') document(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.flow.document(user,id);}
  @Get('documents/:id/download') download(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.flow.document(user,id,true);}
}
