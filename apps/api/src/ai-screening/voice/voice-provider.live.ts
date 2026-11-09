// Explicit one-session transport smoke. Uses synthetic browser audio, never a real microphone.
import 'reflect-metadata';
import fs from 'node:fs';import path from 'node:path';import { createRequire } from 'node:module';
import { ConfigService } from '@nestjs/config';
import { VoiceProvider } from './voice.provider';
import { createVoiceRequest } from '../prompts/voice-session';
async function main(){
 if(process.env.RECRUITMENT_LIVE_VOICE!=='1')throw Error('Explicit opt-in required');
 const root=path.resolve('.'),key=fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).find(line=>/^OPENAI_API_KEY=/.test(line))?.slice('OPENAI_API_KEY='.length).trim().replace(/^['"]|['"]$/g,'');if(!key)throw Error('Local API key missing');
 const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';const {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
 const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']}),context=await browser.newContext({permissions:['microphone']});
 const provider=new VoiceProvider(new ConfigService({OPENAI_API_KEY:key}));let id:string|undefined,channel:ReturnType<VoiceProvider['attach']>|undefined,closed=false,closing=false,usage:unknown;const events:Record<string,number>={},errors:string[]=[];
 try{
  const page=await context.newPage();await page.goto('http://127.0.0.1:3035/id',{waitUntil:'domcontentloaded',timeout:120000});
  const offer=await page.evaluate(async()=>{const peer=new RTCPeerConnection(),stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>peer.addTrack(t,stream));const audio=document.createElement('audio');audio.autoplay=true;document.body.append(audio);peer.ontrack=e=>{audio.srcObject=e.streams[0];};peer.createDataChannel('live-events');await peer.setLocalDescription(await peer.createOffer());await new Promise(resolve=>setTimeout(resolve,1200));(window as any).liveSmoke={peer,stream,audio};return peer.localDescription!.sdp;});
  const response=await provider.create(createVoiceRequest({model:'gpt-live-1',reasoningModel:'gpt-6-luna',voice:'marin',jobTitle:'Backend Developer',companyName:'Perusahaan Uji Sintetis',job:{title:'Backend Developer',description:'Membangun API TypeScript.'},plan:{claims:[{id:'claim1',criterionId:'api',statement:'Membuat API TypeScript',quote:'Membuat API TypeScript',lineStart:1,lineEnd:1,question:'Ceritain satu API yang lu kerjakan sendiri.'}],limitations:[]}},offer));
  id=response.session.id;
  channel=provider.attach(id,event=>{const type=String(event.type);events[type]=(events[type]??0)+1;if(type==='session.started')channel?.send({type:'session.commentary.append',delegation_id:null,content:'Sapa kandidat dalam bahasa Indonesia sebagai Tara, lalu ajukan pertanyaan pertama yang sudah disiapkan.'});if(type==='error'){const code=String((event.error as {code?:string})?.code??'provider-error');if(!(closing&&code==='context_injection_incomplete'))errors.push(code);}if(type==='session.output_audio.fixture.played')channel?.send({type:'session.commentary.append',delegation_id:null,content:'Terima kasih. Interview kita sudah selesai.'});if(type==='session.closed'){closed=true;usage=event.usage;}},()=>{});await channel.opened;
  await page.evaluate(async(sdp:string)=>{await (window as any).liveSmoke.peer.setRemoteDescription({type:'answer',sdp});},response.transport.sdp);
  const until=Date.now()+12000;while(Date.now()<until&&!events['session.output_transcript.delta'])await new Promise(resolve=>setTimeout(resolve,250));
  closing=true;channel.send({type:'session.input_audio.mute'});channel.send({type:'session.output_audio.fixture.play',audio:Buffer.alloc(4800).toString('base64')});await new Promise(resolve=>setTimeout(resolve,2000));channel.send({type:'session.close'});const end=Date.now()+5000;while(!closed&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,100));
  if(!closed)await provider.hangup(id);
  console.log(JSON.stringify({test:'gpt-live-1-production-request',created:true,outputTranscript:Boolean(events['session.output_transcript.delta']),closed,usage,errors,events}));
  if(!events['session.output_transcript.delta']||errors.length)process.exitCode=1;
 }finally{if(id&&!closed)await provider.hangup(id).catch(()=>undefined);channel?.dispose();await context.close();await browser.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Voice provider test failed');if(error&&typeof error==='object'&&'providerMessage' in error)console.error(error.providerMessage);process.exitCode=1;});
