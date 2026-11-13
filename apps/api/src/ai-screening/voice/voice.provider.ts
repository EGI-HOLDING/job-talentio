import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
@Injectable()
export class VoiceProvider {
 constructor(private config:ConfigService){}
 get configured(){return Boolean(this.config.get<string>('OPENAI_API_KEY'));}
 private headers(){return {Authorization:'Bearer '+this.config.get<string>('OPENAI_API_KEY'),'Content-Type':'application/json'};}
 async create(body:unknown){const response=await fetch('https://api.openai.com/v1/live/sessions',{method:'POST',headers:this.headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(25_000)});if(!response.ok){const detail=await response.json().catch(()=>({})) as {error?:{code?:string;param?:string;message?:string}};const error=new Error('VOICE_PROVIDER_HTTP_'+response.status+':'+String(detail.error?.code??'UNKNOWN')+':'+String(detail.error?.param??''));Object.assign(error,{providerMessage:detail.error?.message});throw error;}return response.json() as Promise<{session:{id:string};transport:{sdp:string}}>;}
 attach(id:string,onEvent:(event:Record<string,unknown>)=>void,onLost:()=>void){
  const socket=new WebSocket('wss://api.openai.com/v1/live/sessions/'+encodeURIComponent(id)+'/attach',{headers:this.headers(),handshakeTimeout:10_000,maxPayload:4*1024*1024});
  let ready=false;
  const opened=new Promise<void>((resolve,reject)=>{
   socket.once('open',()=>{ready=true;resolve();});
   const unavailable=()=>reject(Error('VOICE_SIDEBAND_UNAVAILABLE'));
   socket.once('error',unavailable);
   socket.once('close',unavailable);
  });
  socket.on('message',bytes=>{try{onEvent(JSON.parse(bytes.toString()));}catch{/* Ignore malformed provider events; transcript loss is handled by the watchdog. */}});
  socket.on('close',()=>{if(ready)onLost();});socket.on('error',()=>{if(ready)onLost();});
  return {opened,send:(event:unknown)=>{if(socket.readyState!==WebSocket.OPEN)throw Error('VOICE_SIDEBAND_CLOSED');socket.send(JSON.stringify(event));},dispose:()=>socket.close()};
 }
 async hangup(id:string){const response=await fetch('https://api.openai.com/v1/live/sessions/'+encodeURIComponent(id)+'/hangup',{method:'POST',headers:this.headers(),signal:AbortSignal.timeout(10_000)});if(!response.ok&&response.status!==404)throw Error('VOICE_HANGUP_HTTP_'+response.status);}
}
