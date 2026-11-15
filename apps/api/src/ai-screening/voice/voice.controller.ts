import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard,RolesGuard,Roles,CurrentUser,type AuthUser } from '../../common/auth.decorators';
import { parseDto } from '../../common/utils';
import { VoiceService } from './voice.service';
import { VOICE_MEDIA_SIGNALS } from './voice-native';
const client=z.object({clientId:z.string().min(8).max(150)}).strict();
const connection=client.extend({connectionId:z.string().min(1).max(150).optional()});
@Controller('ai-screening/sessions/:id/voice') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('EMPLOYEE')
export class VoiceController {
 constructor(private voice:VoiceService){}
 @Get() state(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.voice.state(user,id);}
 @Post() create(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){const input=parseDto(client.extend({sdp:z.string().min(20).max(100_000),audioProtocol:z.string().max(80).optional(),attemptKey:z.string().uuid().optional()}),body);return this.voice.create(user,id,input.clientId,input.sdp,input.audioProtocol,input.attemptKey);}
 @Post('heartbeat') heartbeat(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){
  const input=parseDto(connection.extend({connected:z.boolean().optional()}),body);
  return this.voice.heartbeat(user,id,input.clientId,input.connected,input.connectionId);
 }
 @Post('media') media(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){
  const input=parseDto(connection.extend({event:z.enum(VOICE_MEDIA_SIGNALS),
   sequence:z.number().int().positive().max(10000),delayMs:z.number().int().min(0).max(2500)}),body);
  return this.voice.media(user,id,input.clientId,input.event,input.sequence,input.delayMs,input.connectionId);
 }
 @Post('end') end(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){const input=parseDto(connection.extend({reason:z.enum(['CANDIDATE_ENDED','CANDIDATE_PAUSED','CANDIDATE_LEFT','CONNECTION_FAILED','CONNECTION_LOST']).default('CANDIDATE_ENDED')}),body);return this.voice.end(user,id,input.clientId,input.reason,input.connectionId);}
}
