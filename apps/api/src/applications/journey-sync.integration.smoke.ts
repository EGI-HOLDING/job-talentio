import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { RolesGuard, type AuthUser } from '../common/auth.decorators';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsController } from '../notifications/notifications.controller';
import { ChatController } from '../chat/chat.controller';
import { ChatService } from '../chat/chat.service';
import { OperationsService } from '../benefits/operations.service';
import { LiveUpdates } from '../common/live-updates';
import { ChatGateway } from '../chat/chat.gateway';
import { PresenceService } from '../presence/presence.service';
import { createRequire } from 'node:module';
import { join } from 'node:path';

async function main() {
  assert.equal(process.env.DATABASE_URL, process.env.HR_TEST_DATABASE_URL);
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, '127.0.0.1');
  assert.match(target.pathname, /^\/talentio_hr_it_\d+$/);
  const db = new PrismaService();
  await db.$connect();
  const failures: string[] = [];
  async function check(name: string, run: () => Promise<void>) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + (error as Error).message); }
  }
  const secret = 'journey-isolated-http-fixture-signing-key-2026';
  const jwt = new JwtService({secret});
  const config = new ConfigService({JWT_SECRET:secret});
  const user = async (name: string, role: 'RECRUITER'|'EMPLOYEE') => db.user.create({data:{fullName:name,role,email:name+'@example.test',emailVerified:true,...(role==='EMPLOYEE'?{employeeProfile:{create:{headline:'Frontend developer',visibility:'PRIVATE'}}}:{})}});
  const [owner, recruiter, employee, stranger] = await Promise.all([user('owner','RECRUITER'),user('recruiter','RECRUITER'),user('employee','EMPLOYEE'),user('stranger','EMPLOYEE')]);
  const company = await db.company.create({data:{name:'Journey fixture',slug:'journey-fixture',members:{create:[{userId:owner.id,role:'OWNER'},{userId:recruiter.id,role:'RECRUITER'}]}}});
  const job = await db.jobPost.create({data:{companyId:company.id,title:'Frontend developer',description:'Isolated journey verification role.',status:'PUBLISHED',publishedAt:new Date()}});
  const companies={assertMember:async(actor:AuthUser,id:string)=>{
    const membership=await db.companyMember.findUnique({where:{companyId_userId:{companyId:id,userId:actor.id}},include:{company:true}});
    if(!membership) { const {ForbiddenException}=await import('@nestjs/common'); throw new ForbiddenException(); }
    return {company:membership.company};
  }};
  const live = new LiveUpdates(), operations = new OperationsService(db);
  const notifications = new NotificationsService(db,live);
  const presence={getPresence:async()=>({}),getOne:async()=>({isOnline:false}),markOnline:async()=>false,markOffline:async()=>false,heartbeat:async()=>{}};
  const chat = new ChatService(db,presence as never,notifications,{sendMessage:async()=>false} as never,live,operations);
  const applications = new ApplicationsService(db,{} as never,companies as never,new MatchingService(db),notifications,{send:async()=>({skipped:true})} as never,operations,undefined,live);
  Reflect.defineMetadata('design:paramtypes',[ApplicationsService],ApplicationsController);
  Reflect.defineMetadata('design:paramtypes',[ChatService],ChatController);
  Reflect.defineMetadata('design:paramtypes',[Reflector],RolesGuard);
  Reflect.defineMetadata('design:paramtypes',[NotificationsService],NotificationsController);
  Reflect.defineMetadata('design:paramtypes',[JwtService,ConfigService,ChatService,PrismaService,PresenceService,LiveUpdates],ChatGateway);
  class FixtureModule {}
  Module({})(FixtureModule);
  const app = await NestFactory.create({module:FixtureModule,imports:[PassportModule.register({defaultStrategy:'jwt'})],controllers:[ApplicationsController,ChatController,NotificationsController],providers:[
    {provide:ApplicationsService,useValue:applications},{provide:ChatService,useValue:chat},
    {provide:JwtStrategy,useValue:new JwtStrategy(config,db)},{provide:RolesGuard,useValue:new RolesGuard(new Reflector())},
    ChatGateway,{provide:JwtService,useValue:jwt},{provide:ConfigService,useValue:config},
    {provide:PrismaService,useValue:db},{provide:PresenceService,useValue:presence},{provide:LiveUpdates,useValue:live},
    {provide:NotificationsService,useValue:notifications},
  ]},{logger:['error']});
  app.setGlobalPrefix('api');
  app.enableCors({origin:process.env.WEB_URL||'http://127.0.0.1:3089',credentials:true});
  await app.listen(process.env.JOURNEY_BROWSER_TEST ? 4091 : 0,'127.0.0.1');
  const base=await app.getUrl();
  const tokens=new Map([owner,recruiter,employee,stranger].map(account=>[account.id,jwt.sign({sub:account.id,tv:0},{expiresIn:'5m'})]));
  const {io}=createRequire(join(process.cwd(),'apps/web/package.json'))('socket.io-client');
  const sockets:any[]=[];
  async function listen(account:typeof employee) {
    const socket=io(base+'/chat',{auth:{token:tokens.get(account.id)},transports:['websocket'],reconnection:false});
    sockets.push(socket);const hints:string[]=[];socket.on('resource:changed',(event:any)=>hints.push(event.resource));
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket did not connect')),5000);socket.once('connect',()=>{clearTimeout(timer);resolve();});socket.once('connect_error',(error:Error)=>{clearTimeout(timer);reject(error);});});
    return hints;
  }
  let employeeHints:string[], recruiterHints:string[], strangerHints:string[];
  try {
    employeeHints=await listen(employee); recruiterHints=await listen(recruiter); strangerHints=await listen(stranger);
  } catch (error) { for(const socket of sockets)socket.disconnect(); await app.close(); await db.$disconnect(); throw error; }
  async function waitFor(predicate:()=>boolean) { for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.ok(predicate(),'Expected authenticated realtime invalidation'); }
  async function request(actor: typeof employee, path:string, body?: unknown, expected=200, key?: string) {
    const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+tokens.get(actor.id),'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    assert.equal(response.status,expected,path+' '+JSON.stringify(result).slice(0,250));return result;
  }
  try {
    const applied=await request(employee,'/applications/jobs/'+job.id,{},201);
    const conversation=await request(recruiter,'/chat/conversations',{peerUserId:employee.id,jobPostId:job.id},201);
    await check('HR chat reaches the exact employee and reply reaches the same HR thread',async()=>{
      await request(recruiter,'/chat/conversations/'+conversation.id+'/messages',{body:'HR fixture message'},201);
      const inbox=await request(employee,'/chat/conversations');assert.equal(inbox.find((row:any)=>row.id===conversation.id)?.messages[0].body,'HR fixture message');
      const messages=await request(employee,'/chat/conversations/'+conversation.id+'/messages');assert.equal(messages.at(-1).body,'HR fixture message');
      await request(employee,'/chat/conversations/'+conversation.id+'/messages',{body:'Employee fixture reply'},201);
      const received=await request(recruiter,'/chat/conversations');assert.equal(received.find((row:any)=>row.id===conversation.id)?.messages[0].body,'Employee fixture reply');
      const thread=await request(recruiter,'/chat/conversations/'+conversation.id+'/messages');assert.equal(thread.length,2);assert.ok(thread[0].readAt);assert.ok(thread[1].readAt);
    });
    await check('Employee application chat continues with the handling recruiter instead of another owner',async()=>{
      const mine=await request(employee,'/applications/mine');assert.equal(mine[0].jobPost.company.chatPeerUserId,recruiter.id);
    });
    await check('HTTP sends push live hints to both participants, keep idempotency after retry and do not notify a stranger',async()=>{
      employeeHints.length=0;recruiterHints.length=0;strangerHints.length=0;
      const before=await db.chatMessage.count({where:{conversationId:conversation.id}});
      const data={body:'Retry-safe HR message'};
      const [first,second]=await Promise.all([request(recruiter,'/chat/conversations/'+conversation.id+'/messages',data,201,'journey-chat-once'),request(recruiter,'/chat/conversations/'+conversation.id+'/messages',data,201,'journey-chat-once')]);
      assert.equal(first.id,second.id);assert.equal(await db.chatMessage.count({where:{conversationId:conversation.id}}),before+1);
      await waitFor(()=>employeeHints.includes('chat')&&recruiterHints.includes('chat'));
      assert.equal(strangerHints.length,0);
      await request(recruiter,'/chat/conversations/'+conversation.id+'/messages',{body:'Different intent'},409,'journey-chat-once');
    });
    await check('Every progress status is identical in employee list, HR detail and Kanban',async()=>{
      for(const status of ['IN_REVIEW','INTERVIEW','OFFER','HIRED','REJECTED']) {
        employeeHints.length=0;recruiterHints.length=0;
        await request(recruiter,'/applications/'+applied.id+'/status',{status},201);
        const mine=await request(employee,'/applications/mine');assert.equal(mine[0].status,status);
        const detail=await request(recruiter,'/applications/jobs/'+job.id+'/applicants/'+applied.id);assert.equal(detail.status,status);
        const board=await request(recruiter,'/applications/jobs/'+job.id+'/kanban');assert.equal(board.columns.find((column:any)=>column.status===status).items[0].id,applied.id);
        await waitFor(()=>employeeHints.includes('applications')&&recruiterHints.includes('applications'));
      }
    });
    await request(recruiter,'/applications/'+applied.id+'/status',{status:'IN_REVIEW'},201);
    await check('Server rejects past interview times through the authenticated HTTP endpoint',async()=>{
      await request(recruiter,'/applications/'+applied.id+'/interviews',{scheduledAt:'2020-01-01T10:00:00Z'},400,'journey-past-interview');
    });
    await check('Interview scheduling requires the application to already be in the Interview stage',async()=>{
      const data={scheduledAt:new Date(Date.now()+3600000).toISOString(),durationMins:45,location:'Fixture room',meetingUrl:'https://example.test/meeting',note:'Candidate-visible fixture note'};
      await request(recruiter,'/applications/'+applied.id+'/interviews',data,400,'journey-interview-before-stage');
      assert.equal((await request(recruiter,'/applications/jobs/'+job.id+'/applicants/'+applied.id)).status,'IN_REVIEW');
    });
    await request(recruiter,'/applications/'+applied.id+'/status',{status:'INTERVIEW'},201);
    await check('Multiple interview appointments remain in one stage, retries are idempotent, and finalization cancels pending appointments',async()=>{
      const data={scheduledAt:new Date(Date.now()+3600000).toISOString(),durationMins:45,location:'Fixture room',meetingUrl:'https://example.test/meeting',note:'Candidate-visible fixture note'};
      const eventsBefore=await db.pipelineEvent.count({where:{applicationId:applied.id}});
      const scheduled=await request(recruiter,'/applications/'+applied.id+'/interviews',data,201,'journey-future-interview');
      const repeated=await request(recruiter,'/applications/'+applied.id+'/interviews',data,201,'journey-future-interview');assert.equal(repeated.id,scheduled.id);
      const nextData={...data,scheduledAt:new Date(Date.now()+7200000).toISOString(),meetingUrl:'https://example.test/meeting-next',note:'Second conversation'};
      const next=await request(recruiter,'/applications/'+applied.id+'/interviews',nextData,201,'journey-next-interview');assert.notEqual(next.id,scheduled.id);
      const detail=await request(recruiter,'/applications/jobs/'+job.id+'/applicants/'+applied.id);assert.equal(detail.status,'INTERVIEW');assert.equal(detail.interviews.length,2);assert.equal(await db.pipelineEvent.count({where:{applicationId:applied.id}}),eventsBefore,'Scheduling appointments does not create extra stage transitions');
      const mine=await request(employee,'/applications/mine');assert.equal(mine[0].status,'INTERVIEW');assert.equal(mine[0].interviews.length,2);assert.equal(mine[0].interviews.find((item:any)=>item.id===scheduled.id).meetingUrl,data.meetingUrl);
      await request(employee,'/applications/'+applied.id+'/status',{status:'WITHDRAWN'},201);
      const cancelled=await request(recruiter,'/applications/'+applied.id+'/interviews');assert.equal(cancelled.length,2);assert.ok(cancelled.every((item:any)=>item.status==='CANCELLED'));
    });
    await check('Foreign candidates cannot read chat, application interviews or move another candidate',async()=>{
      await request(stranger,'/chat/conversations/'+conversation.id+'/messages',undefined,403);
      await request(stranger,'/applications/'+applied.id+'/interviews',undefined,403);
      await request(stranger,'/applications/'+applied.id+'/status',{status:'HIRED'},403);
    });
    await check('A confidential employer stays revealed after interview, while withdrawal closes its chat',async()=>{
      const anonymous=await db.jobPost.create({data:{companyId:company.id,title:'Private vacancy',description:'Confidential isolated fixture role.',status:'PUBLISHED',isAnonymous:true}});
      const application=await request(employee,'/applications/jobs/'+anonymous.id,{},201);
      await request(recruiter,'/chat/conversations',{peerUserId:employee.id,jobPostId:anonymous.id},403);
      const hidden=await request(employee,'/applications/mine');assert.equal(hidden.find((item:any)=>item.id===application.id).jobPost.company.id,'');
      await request(recruiter,'/applications/'+application.id+'/status',{status:'INTERVIEW'},201);
      const thread=await request(recruiter,'/chat/conversations',{peerUserId:employee.id,jobPostId:anonymous.id},201);
      await request(recruiter,'/chat/conversations/'+thread.id+'/messages',{body:'Confidential process message'},201);
      for(const status of ['REJECTED','IN_REVIEW']) {
        await request(recruiter,'/applications/'+application.id+'/status',{status},201);
        const mine=await request(employee,'/applications/mine');assert.equal(mine.find((item:any)=>item.id===application.id).jobPost.company.id,company.id);
        assert.ok((await request(employee,'/chat/conversations')).some((item:any)=>item.id===thread.id));
        assert.equal((await request(employee,'/chat/conversations/'+thread.id+'/messages'))[0].body,'Confidential process message');
      }
      await request(employee,'/applications/'+application.id+'/status',{status:'WITHDRAWN'},201);
      const mine=await request(employee,'/applications/mine');assert.equal(mine.find((item:any)=>item.id===application.id).jobPost.company.id,company.id);
      assert.ok(await db.conversation.findUnique({where:{id:thread.id}}),'withdrawal must retain the conversation record');
      assert.equal(await db.chatMessage.count({where:{conversationId:thread.id}}),1,'withdrawal must retain existing messages');
      assert.ok(!(await request(employee,'/chat/conversations')).some((item:any)=>item.id===thread.id));
      assert.ok(!(await request(recruiter,'/chat/conversations')).some((item:any)=>item.id===thread.id));
      await request(employee,'/chat/conversations/'+thread.id+'/messages',undefined,404);
      await request(recruiter,'/chat/conversations/'+thread.id+'/messages',undefined,404);
      await request(employee,'/chat/conversations/'+thread.id+'/messages',{body:'Cannot send after withdrawal'},404);
      await request(recruiter,'/chat/conversations/'+thread.id+'/messages',{body:'Cannot send after withdrawal'},404);
      await request(employee,'/chat/conversations',{peerUserId:recruiter.id,jobPostId:anonymous.id},404);
      await request(recruiter,'/chat/conversations',{peerUserId:employee.id,jobPostId:anonymous.id},404);
    });
    await check('Chat insertion rolls back if conversation update fails',async()=>{
      const rollbackJob=await db.jobPost.create({data:{companyId:company.id,title:'Rollback fixture',description:'Isolated active chat fixture.',status:'PUBLISHED',publishedAt:new Date()}});
      const rollbackApplication=await request(employee,'/applications/jobs/'+rollbackJob.id,{},201);
      await request(recruiter,'/applications/'+rollbackApplication.id+'/status',{status:'IN_REVIEW'},201);
      const rollbackConversation=await request(recruiter,'/chat/conversations',{peerUserId:employee.id,jobPostId:rollbackJob.id},201);
      const before=await db.chatMessage.count({where:{conversationId:rollbackConversation.id}});
      const failing=new ChatService({
        conversation:db.conversation,companyMember:db.companyMember,jobPost:db.jobPost,application:db.application,
        $transaction:(run:any)=>db.$transaction(tx=>run({...tx,$queryRaw:(query:any)=>tx.$queryRaw(query),chatMessage:tx.chatMessage,conversation:{update:async()=>{throw Error('Injected conversation failure');}}})),
      } as never,presence as never,notifications,{} as never);
      const actor={...recruiter,memberships:[{companyId:company.id,role:'RECRUITER' as const}]};
      await assert.rejects(()=>failing.sendMessage(actor,rollbackConversation.id,'MUST ROLLBACK'),/Injected conversation failure/);
      assert.equal(await db.chatMessage.count({where:{conversationId:rollbackConversation.id}}),before);
    });
    if (process.env.JOURNEY_BROWSER_TEST) {
      await check('Two isolated browser accounts exchange messages and track recruiter progress in four languages',async()=>{
        const fixtures=[];
        for(const locale of ['id','uz','en','ru']) {
          const vacancy=await db.jobPost.create({data:{companyId:company.id,title:'Browser fixture '+locale,description:'Isolated browser journey vacancy.',status:'PUBLISHED',publishedAt:new Date()}});
          const application=await request(employee,'/applications/jobs/'+vacancy.id,{},201);
          fixtures.push({locale,job:vacancy,applicationId:application.id});
        }
        await createRequire(join(process.cwd(),'package.json'))('./scripts/journey-sync-browser.smoke.cjs')({base,tokens:Object.fromEntries(tokens),owner,recruiter,employee,company,fixtures});
      });
    }
    assert.equal(failures.length,0,'Journey failures: '+failures.join('; '));
    console.log('PASS: real HTTP/JWT, disposable PostgreSQL, both roles, progress and messaging synchronization.');
  } finally { for(const socket of sockets)socket.disconnect(); await app.close(); await db.$disconnect(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
