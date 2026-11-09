import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { parseDto } from '../../common/utils';
import { InvitationsService } from './invitations.service';
import { invitationCreateSchema } from './invitation.policy';
import { z } from 'zod';
@Controller('recruitment')
export class InvitationsController {
 constructor(private invitations:InvitationsService){}
 @Post('candidates/:id/invitations') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('RECRUITER','SUPER_ADMIN')
 create(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){return this.invitations.create(user,id,parseDto(invitationCreateSchema,body));}
 @Get('candidates/:id/invitations') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('RECRUITER','SUPER_ADMIN')
 list(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.invitations.list(user,id);}
 @Get('invitations/:id/report') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('RECRUITER','SUPER_ADMIN')
 report(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.invitations.report(user,id);}
 @Post('invitations/:id/retry-delivery') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('RECRUITER','SUPER_ADMIN')
 retryDelivery(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){return this.invitations.retryDelivery(user,id,parseDto(z.object({acknowledgePossibleDuplicate:z.boolean().default(false)}).strict(),body??{}).acknowledgePossibleDuplicate);}
 @Post('invitations/:id/retry-evaluation') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('RECRUITER','SUPER_ADMIN')
 retryEvaluation(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.invitations.retryEvaluation(user,id);}
 @Post('invitations/:id/cancel') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('RECRUITER','SUPER_ADMIN')
 cancel(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.invitations.cancel(user,id);}
 @Get('invitations/open/:token') preview(@Param('token') token:string){return this.invitations.preview(token);}
 @Post('invitations/open/:token/claim') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('EMPLOYEE')
 claim(@CurrentUser() user:AuthUser,@Param('token') token:string){return this.invitations.claim(user,token);}
}
