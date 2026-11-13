import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard,RolesGuard,Roles,CurrentUser,type AuthUser } from '../../common/auth.decorators';
import { parseDto } from '../../common/utils';
import { VoiceService } from './voice.service';
const client=z.object({clientId:z.string().min(8).max(150)}).strict();
@Controller('ai-screening/sessions/:id/voice') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('EMPLOYEE')
export class VoiceController {
 constructor(private voice:VoiceService){}
 @Get() state(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.voice.state(user,id);}
 @Post() create(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){const input=parseDto(client.extend({sdp:z.string().min(20).max(100_000)}),body);return this.voice.create(user,id,input.clientId,input.sdp);}
 @Post('heartbeat') heartbeat(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){return this.voice.heartbeat(user,id,parseDto(client,body).clientId);}
 @Post('media') media(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){
  const input=parseDto(client.extend({event:z.enum(['READY','AUDIBLE','QUIET','INTERRUPTED','TEXT_SHOWN','OUTPUT_DROPPED']),
   sequence:z.number().int().positive().max(10000),delayMs:z.number().int().min(0).max(2500),transcriptEventId:z.string().min(1).max(256).optional()})
   .refine(input=>(input.event==='TEXT_SHOWN')===Boolean(input.transcriptEventId)),body);
  return this.voice.media(user,id,input.clientId,input.event,input.sequence,input.delayMs,input.transcriptEventId);
 }
 @Post('end') end(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){const input=parseDto(client.extend({reason:z.enum(['CANDIDATE_ENDED','CANDIDATE_LEFT','CONNECTION_FAILED','CONNECTION_LOST']).default('CANDIDATE_ENDED')}),body);return this.voice.end(user,id,input.clientId,input.reason);}
}
