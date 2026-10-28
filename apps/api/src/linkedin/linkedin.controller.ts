import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { linkedinApprovalSchema, linkedinConnectSchema, linkedinPreferencesSchema, linkedinPreviewSchema, linkedinReconcileSchema } from '@job-talentio/shared';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { requestLocale } from '../common/i18n/request-locale';
import { LinkedInService, LINKEDIN_COOKIE, LINKEDIN_COOKIE_PATH } from './linkedin.service';
import { LinkedInSettings } from './linkedin-settings';
import { PrismaService } from '../prisma/prisma.service';
import { LinkedInWorkerService } from './linkedin-worker.service';

@Controller('integrations/linkedin')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('RECRUITER','SUPER_ADMIN')
export class LinkedInController {
  constructor(private linkedin:LinkedInService,private settings:LinkedInSettings) {}
  @Get()status(@CurrentUser()user:AuthUser){return this.linkedin.status(user);}
  @Post('connect')async connect(@CurrentUser()user:AuthUser,@Body()body:unknown,@Req()req:Request,@Res({passthrough:true})res:Response){
    const data=parseDto(linkedinConnectSchema,body);
    if(this.settings.canConnect && req.get('host')!==new URL(this.settings.redirectUri).host)throw new BadRequestException('Open Talentio through the configured HTTPS API domain to connect LinkedIn securely');
    const result=await this.linkedin.startConnection(user,data.returnTo);
    res.cookie(LINKEDIN_COOKIE,result.cookie,{httpOnly:true,secure:true,sameSite:'lax',path:LINKEDIN_COOKIE_PATH,maxAge:600000});
    res.setHeader('Cache-Control','no-store');return {authorizationUrl:result.authorizationUrl};
  }
  @Patch()preferences(@CurrentUser()user:AuthUser,@Body()body:unknown){return this.linkedin.preferences(user,parseDto(linkedinPreferencesSchema,body).autoShareEnabled);}
  @Delete()disconnect(@CurrentUser()user:AuthUser){return this.linkedin.disconnect(user);}
}

// Public OAuth redirect is bound to a one-time DB state AND an HttpOnly cookie.
@Controller('integrations/linkedin')
export class LinkedInCallbackController {
  constructor(private linkedin:LinkedInService){}
  @Get('callback')async callback(@Query()query:Record<string,unknown>,@Req()req:Request,@Res()res:Response){
    const raw=(req.headers.cookie || '').split(';').map(value=>value.trim()).find(value=>value.startsWith(LINKEDIN_COOKIE+'='));
    const cookie=raw?.slice(LINKEDIN_COOKIE.length+1);
    const input={state:typeof query.state==='string'?query.state:undefined,code:typeof query.code==='string'?query.code:undefined,error:typeof query.error==='string'?query.error:undefined};
    res.clearCookie(LINKEDIN_COOKIE,{httpOnly:true,secure:true,sameSite:'lax',path:LINKEDIN_COOKIE_PATH});
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    return res.redirect(302,await this.linkedin.callback(input,cookie));
  }
}

@Controller('jobs')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('RECRUITER','SUPER_ADMIN')
export class LinkedInJobController {
  constructor(private linkedin:LinkedInService){}
  @Post(':id/linkedin/preview')preview(@CurrentUser()user:AuthUser,@Param('id')id:string,@Body()body:unknown,@Req()req:Request){return this.linkedin.preview(user,id,parseDto(linkedinPreviewSchema,body).locale || requestLocale(req));}
  @Get(':id/social-posts')list(@CurrentUser()user:AuthUser,@Param('id')id:string){return this.linkedin.list(user,id);}
  @Post(':id/social-posts')request(@CurrentUser()user:AuthUser,@Param('id')id:string,@Body()body:unknown){return this.linkedin.requestShare(user,id,parseDto(linkedinApprovalSchema,body).previewId);}
}

@Controller('social-posts')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('RECRUITER','SUPER_ADMIN')
export class LinkedInPostController {
  constructor(private linkedin:LinkedInService){}
  @Post(':id/retry')retry(@CurrentUser()user:AuthUser,@Param('id')id:string,@Body()body:unknown){return this.linkedin.retry(user,id,parseDto(linkedinApprovalSchema,body).previewId);}
  @Post(':id/cancel')cancel(@CurrentUser()user:AuthUser,@Param('id')id:string){return this.linkedin.cancel(user,id);}
  @Post(':id/reconcile')reconcile(@CurrentUser()user:AuthUser,@Param('id')id:string,@Body()body:unknown){const data=parseDto(linkedinReconcileSchema,body);return this.linkedin.reconcile(user,id,data.outcome,data.postUrn);}
  @Get(':id/poster')async poster(@CurrentUser()user:AuthUser,@Param('id')id:string,@Res({passthrough:true})res:Response){res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','private, no-store');return new StreamableFile(await this.linkedin.poster(user,id));}
}

@Controller('admin/linkedin')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN')
export class LinkedInAdminController {
  constructor(private prisma:PrismaService,private worker:LinkedInWorkerService,private settings:LinkedInSettings){}
  @Get('metrics')async metrics(){
    const [posts,oldest,connections,expiring,failures,daily,operations]=await Promise.all([
      this.prisma.linkedInSocialPost.groupBy({by:['status'],_count:{_all:true}}),
      this.prisma.linkedInSocialPost.aggregate({where:{status:'PENDING'},_min:{createdAt:true}}),
      this.prisma.linkedInConnection.groupBy({by:['status'],_count:{_all:true}}),
      this.prisma.linkedInConnection.count({where:{status:'CONNECTED',tokenExpiresAt:{gt:new Date(),lte:new Date(Date.now()+14*86400000)}}}),
      this.prisma.linkedInSocialPost.groupBy({by:['errorCode'],where:{status:{in:['FAILED','UNKNOWN']}},_count:{_all:true},orderBy:{_count:{errorCode:'desc'}},take:10}),
      this.prisma.linkedInSocialPost.groupBy({by:['status'],where:{updatedAt:{gte:new Date(new Date().setUTCHours(0,0,0,0))}},_count:{_all:true}}),
      this.worker.operationalMetrics(),
    ]);return {posts,connections,oldestQueuedAt:oldest._min.createdAt,expiring,failures,daily,operations,enabled:this.settings.canConnect,sharingEnabled:this.settings.canShare,apiVersion:this.settings.version,generatedAt:new Date()};
  }
}
