import { Body, Controller, Get, Header, Headers, Param, ParseIntPipe, Post, StreamableFile, UseGuards } from '@nestjs/common';
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
 @Get('playback/:revision') @Header('Cache-Control','private, no-store')
 async clip(@CurrentUser() user:AuthUser,@Param('id') id:string,@Param('revision',ParseIntPipe) revision:number,@Headers('x-tara-client') value:unknown){
  const {clientId}=parseDto(client,{clientId:value});
  return new StreamableFile(await this.voice.clip(user,id,clientId,revision),{type:'audio/wav'});
 }
 @Post('playback') playback(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){
  const input=parseDto(client.extend({event:z.enum(['READY','AUDIO_PLAYED','TEXT_SHOWN','AUDIO_FAILED']),revision:z.number().int().positive().optional()})
   .refine(input=>input.event==='READY'?input.revision===undefined:input.revision!==undefined),body);
  return this.voice.playback(user,id,input.clientId,input.event,input.revision);
 }
 @Post('end') end(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:unknown){const input=parseDto(client.extend({reason:z.enum(['CANDIDATE_ENDED','CANDIDATE_LEFT','CONNECTION_FAILED','CONNECTION_LOST']).default('CANDIDATE_ENDED')}),body);return this.voice.end(user,id,input.clientId,input.reason);}
}
