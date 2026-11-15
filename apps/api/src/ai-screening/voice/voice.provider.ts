import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';

export class VoiceCreationRejected extends Error {}

@Injectable()
export class VoiceProvider {
 constructor(private config:ConfigService){}
 get configured(){return Boolean(this.config.get<string>('OPENAI_API_KEY'));}
 private headers(){return {Authorization:'Bearer '+this.config.get<string>('OPENAI_API_KEY'),'Content-Type':'application/json'};}
 async create(body:unknown, timeoutMs=25_000){
  const response=await fetch('https://api.openai.com/v1/live/sessions',{
   method:'POST',headers:this.headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),
  });
  if(!response.ok){
   const detail=await response.json().catch(()=>undefined) as {error?:{type?:string;code?:string;param?:string;message?:string}}|undefined;
   const failure=detail?.error;
   // A Live API rejection confirms startup failed. An unstructured 5xx can
   // come from a gateway that lost the result of the request.
   const rejected=response.status<500||typeof failure?.type==='string'&&typeof failure.message==='string';
   const ErrorType=rejected?VoiceCreationRejected:Error;
   const error=new ErrorType('VOICE_PROVIDER_HTTP_'+response.status+':'+String(failure?.code??'UNKNOWN')+':'+String(failure?.param??''));
   Object.assign(error,{providerMessage:failure?.message});
   throw error;
  }
  return response.json() as Promise<{session:{id:string};transport:{sdp:string}}>;
 }
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
  const send = (event: object) => {
   if (socket.readyState !== WebSocket.OPEN) throw Error('VOICE_SIDEBAND_CLOSED');
   socket.send(JSON.stringify(event));
  };
  return {
   opened,
   requestOpening: (content: string) => send({ type: 'session.commentary.append', event_id: 'tara-opening',
    delegation_id: null, content }),
   closeSession: () => send({ type: 'session.close' }),
   dispose: () => socket.close(),
  };
 }
 async closeWebRtc(id: string, receive: (event: Record<string, unknown>) => void) {
  let channel: ReturnType<VoiceProvider['attach']> | undefined;
  return new Promise<{ usage: unknown } | undefined>(resolve => {
   let settled = false;
   const finish = (value?: { usage: unknown }) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    channel?.dispose();
    resolve(value);
   };
   const timer = setTimeout(() => finish(), 3000);
   try {
    channel = this.attach(id, event => {
     receive(event);
     if (event.type === 'session.closed') finish({ usage: event.usage });
    }, () => finish());
    void channel.opened.then(() => {
     if (!settled) channel?.closeSession();
    }).catch(() => finish());
   } catch { finish(); }
  });
 }
}
