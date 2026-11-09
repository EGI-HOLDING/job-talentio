import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { parseDto } from '../../common/utils';
import { CandidateActions } from './candidate-actions.service';
import { candidateMessageSchema, candidateInterviewSchema, candidateInterviewUpdateSchema,deliveryRetrySchema } from './candidate-actions.schemas';
@Controller('recruitment') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('RECRUITER','SUPER_ADMIN')
export class CandidateActionsController {
 constructor(private actions:CandidateActions){}
 @Post('messages') send(@CurrentUser() user:AuthUser,@Body() body:unknown){return this.actions.send(user,parseDto(candidateMessageSchema,body));}
 @Get('message-batches/:id') batch(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.actions.batch(user,id);}
 @Post('message-batches/:id/retry') retryBatch(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){return this.actions.retryBatch(user,id,parseDto(deliveryRetrySchema,body??{}).acknowledgePossibleDuplicate);}
 @Get('candidates/:id/messages') messages(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.actions.messages(user,id);}
 @Post('messages/:id/retry') retry(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){return this.actions.retry(user,id,parseDto(deliveryRetrySchema,body??{}).acknowledgePossibleDuplicate);}
 @Get('candidates/:id/interviews') interviews(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.actions.interviews(user,id);}
 @Post('candidates/:id/interviews') schedule(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){return this.actions.schedule(user,id,parseDto(candidateInterviewSchema,body));}
 @Patch('candidates/:id/interviews/:interviewId') update(@CurrentUser() user:AuthUser,@Param('id') id:string,@Param('interviewId') interviewId:string,@Body() body:unknown){return this.actions.updateInterview(user,id,interviewId,parseDto(candidateInterviewUpdateSchema,body));}
}
