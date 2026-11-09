import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { LiveUpdates } from '../../common/live-updates';
import type { AuthUser } from '../../common/auth.decorators';
import { escapeHtml } from '../../common/utils';
import { RecruitmentService } from './recruitment.service';
import { candidateMessageSchema, candidateInterviewSchema, candidateInterviewUpdateSchema, renderCandidateMessage } from './candidate-actions.schemas';
import { enqueueWork } from '../screening-packets.service';
import { hash, json } from '../screening.policy';
import { ANONYMOUS_REVEAL_STATUSES, revealsAnonymousEmployer } from '../../common/anonymous-job';
import { candidateRevealActivities } from '../../chat/recruitment-chat-access';

const contextInclude={company:true,job:true,application:{include:{profile:{include:{user:true}}}}} satisfies Prisma.RecruitmentCandidateInclude;
type Candidate=Prisma.RecruitmentCandidateGetPayload<{include:typeof contextInclude}>;
const safeMessage={id:true,candidateId:true,subject:true,body:true,recipientEmail:true,kind:true,emailStatus:true,messageStatus:true,error:true,createdAt:true} satisfies Prisma.CandidateMessageSelect;
const activeAccount={isBanned:false,anonymizedAt:null} as const;

@Injectable()
export class CandidateActions {
  private waitingCursor:string|undefined;
  constructor(private db:PrismaService,private candidates:RecruitmentService,private mail:MailService,@Optional() private live?:LiveUpdates){}

  private recipient(candidate:Candidate,override?:string){
    const account=candidate.application?.profile.user;
    if(account&&(account.isBanned||account.anonymizedAt))throw new BadRequestException('Akun kandidat tidak tersedia.');
    if(account?.email&&override&&account.email.toLowerCase()!==override.toLowerCase())throw new BadRequestException('Gunakan email akun kandidat yang terhubung dengan lamaran.');
    const email=(account?.email??override??candidate.email??'').trim().toLowerCase();
    if(email&&!candidateMessageSchema.shape.email.unwrap().safeParse(email).success)throw new BadRequestException('Email kandidat tidak valid.');
    if(!email&&!account)throw new BadRequestException(`Email ${candidate.fullName} belum tersedia. Lengkapi email untuk kandidat ini terlebih dahulu.`);
    return {email,userId:account?.id??null};
  }
  private assertCandidate(candidate:Candidate){
    if(!candidate.jobId||!candidate.job)throw new BadRequestException('Tambahkan CV ke lowongan sebelum menghubungi kandidat.');
    if(candidate.stage==='WITHDRAWN'||candidate.scoreStatus==='ERASED'||candidate.company.isBanned||candidate.company.anonymizedAt)throw new BadRequestException('Kandidat atau perusahaan sudah tidak tersedia untuk dihubungi.');
  }
  private async selection(tx:Prisma.TransactionClient,input:z.infer<typeof candidateMessageSchema>){
    const selection=input.selection;
    if('filter' in selection&&selection.filter.companyId!==input.companyId)throw new BadRequestException('Filter perusahaan tidak sesuai.');
    const where:Prisma.RecruitmentCandidateWhereInput='ids' in selection?{companyId:input.companyId,id:{in:selection.ids}}:{...this.candidates.where(selection.filter),id:{notIn:selection.excludedIds}};
    const rows=await tx.recruitmentCandidate.findMany({where,include:contextInclude});
    const expected='ids' in selection?new Set(selection.ids).size:selection.expectedCount;
    if(!rows.length||rows.length!==expected)throw new ConflictException('Daftar kandidat berubah. Perbarui pilihan lalu coba lagi.');
    if(input.email&&rows.length!==1)throw new BadRequestException('Email pengganti hanya dapat digunakan untuk satu kandidat.');
    for(const row of rows){this.assertCandidate(row);if(row.job?.isAnonymous&&!revealsAnonymousEmployer(row.stage)&&!await tx.candidateActivity.count({where:{candidateId:row.id,...candidateRevealActivities}})&&!(row.applicationId&&await tx.pipelineEvent.count({where:{applicationId:row.applicationId,toStatus:{in:[...ANONYMOUS_REVEAL_STATUSES]}}})))throw new BadRequestException('Pindahkan kandidat ke tahap Wawancara sebelum menghubunginya untuk lowongan yang dirahasiakan.');}
    return rows;
  }
  async send(user:AuthUser,input:z.infer<typeof candidateMessageSchema>){
    await this.candidates.access(user,input.companyId);
    const inputHash=hash(input);
    const batch=await this.db.$transaction(async tx=>{
      // Serializes idempotency keys without holding an external provider request in a DB transaction.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id=${input.companyId} FOR UPDATE`);
      const existing=await tx.candidateMessageBatch.findUnique({where:{companyId_requestKey:{companyId:input.companyId,requestKey:input.requestKey}}});
      if(existing){if(existing.inputHash!==inputHash)throw new ConflictException('Kunci pengiriman sudah digunakan untuk pesan lain.');return existing;}
      const rows=await this.selection(tx,input);
      const created=await tx.candidateMessageBatch.create({data:{companyId:input.companyId,createdById:user.id,requestKey:input.requestKey,inputHash,subject:input.subject,bodyTemplate:input.body,email:input.channels.email,talentio:input.channels.talentio}});
      const messages=rows.map(candidate=>{
        const recipient=this.recipient(candidate,input.email),vars={name:candidate.fullName,jobTitle:candidate.job!.title,companyName:candidate.job!.isAnonymous?'Tim rekrutmen':candidate.company.name};
        const optedOut=Boolean(candidate.application?.profile.bulkCommsOptOut);
        return {id:randomUUID(),batchId:created.id,candidateId:candidate.id,recipientEmail:recipient.email,recipientUserId:recipient.userId,subject:renderCandidateMessage(input.subject,vars).replace(/[\r\n]+/g,' ').slice(0,300),body:renderCandidateMessage(input.body,vars),kind:'MESSAGE',emailStatus:optedOut?'OPTED_OUT':!input.channels.email?'SKIPPED':recipient.email?'PENDING':'NO_EMAIL',messageStatus:optedOut?'OPTED_OUT':input.channels.talentio?'PENDING':'SKIPPED'};
      });
      await tx.candidateMessage.createMany({data:messages});
      await tx.aiScreeningWork.createMany({data:messages.filter(m=>m.emailStatus==='PENDING'||m.messageStatus==='PENDING').map(m=>({key:'CANDIDATE_DELIVERY:'+m.id,kind:'CANDIDATE_DELIVERY',subjectId:m.id})),skipDuplicates:true});
      await tx.candidateActivity.createMany({data:rows.map(c=>({candidateId:c.id,actorUserId:user.id,kind:'MESSAGE_QUEUED',detail:json({batchId:created.id})}))});
      return created;
    },{timeout:30000});
    return this.batch(user,batch.id);
  }
  async batch(user:AuthUser,id:string){
    const batch=await this.db.candidateMessageBatch.findUnique({where:{id}});if(!batch)throw new NotFoundException();
    await this.candidates.access(user,batch.companyId);
    const [count,emails,messages,items]=await Promise.all([
      this.db.candidateMessage.count({where:{batchId:id}}),
      this.db.candidateMessage.groupBy({by:['emailStatus'],where:{batchId:id},_count:true}),
      this.db.candidateMessage.groupBy({by:['messageStatus'],where:{batchId:id},_count:true}),
      this.db.candidateMessage.findMany({where:{batchId:id},select:safeMessage,orderBy:{createdAt:'asc'},take:100}),
    ]);
    return{id,count,subject:batch.subject,createdAt:batch.createdAt,emailCounts:Object.fromEntries(emails.map(e=>[e.emailStatus,e._count])),messageCounts:Object.fromEntries(messages.map(m=>[m.messageStatus,m._count])),messages:items};
  }
  async messages(user:AuthUser,candidateId:string){await this.candidates.owned(user,candidateId);return this.db.candidateMessage.findMany({where:{candidateId},select:safeMessage,orderBy:{createdAt:'desc'},take:50});}

  async deliver(id:string){
    const row=await this.db.candidateMessage.findUnique({where:{id},include:{batch:true,interview:true,candidate:{include:contextInclude}}});
    if(!row)return;
    const candidate=row.candidate;
    if(!candidate.jobId||candidate.scoreStatus==='ERASED'||candidate.stage==='WITHDRAWN'||candidate.company.isBanned||candidate.company.anonymizedAt||row.interview&&row.interviewRevision!==row.interview.revision){
      await this.db.candidateMessage.updateMany({where:{id},data:{emailStatus:row.emailStatus==='SENT'?'SENT':'CANCELLED',messageStatus:row.messageStatus==='SENT'?'SENT':'CANCELLED',error:null}});return;
    }
    const recipient=candidate.application?.profile.user??(row.recipientEmail?await this.db.user.findFirst({where:{...activeAccount,email:{equals:row.recipientEmail,mode:'insensitive'},emailVerified:true,role:'EMPLOYEE'},include:{employeeProfile:true}}):null);
    if(recipient&&(recipient.isBanned||recipient.anonymizedAt)){await this.db.candidateMessage.updateMany({where:{id},data:{emailStatus:'CANCELLED',messageStatus:'CANCELLED',error:null}});return;}
    const profile=candidate.application?.profile??(recipient?await this.db.employeeProfile.findUnique({where:{userId:recipient.id},select:{bulkCommsOptOut:true}}):null);
    if(row.kind==='MESSAGE'&&profile?.bulkCommsOptOut){await this.db.candidateMessage.updateMany({where:{id},data:{emailStatus:row.emailStatus==='SENT'?'SENT':'OPTED_OUT',messageStatus:row.messageStatus==='SENT'?'SENT':'OPTED_OUT',error:null}});return;}
    if(['PENDING','WAITING_ACCOUNT','FAILED'].includes(row.messageStatus)){
      if(recipient){
        const participants=await this.db.$transaction(async tx=>{
          await tx.$queryRaw(Prisma.sql`SELECT id FROM "CandidateMessage" WHERE id=${id} FOR UPDATE`);
          const current=await tx.candidateMessage.findUnique({where:{id}});if(!current||current.messageId||!['PENDING','WAITING_ACCOUNT','FAILED'].includes(current.messageStatus))return;
          let senderId=row.batch.createdById;
          if(!senderId||!await tx.companyMember.findFirst({where:{companyId:candidate.companyId,userId:senderId,user:activeAccount}}))senderId=(await tx.companyMember.findFirst({where:{companyId:candidate.companyId,user:activeAccount},orderBy:{createdAt:'asc'}}))?.userId??null;
          if(!senderId||senderId===recipient.id)throw Error('CANDIDATE_MESSAGE_SENDER_UNAVAILABLE');
          const [userAId,userBId]=[senderId,recipient.id].sort();
          const conversation=await tx.conversation.upsert({where:{userAId_userBId_jobPostId:{userAId,userBId,jobPostId:candidate.jobId!}},create:{userAId,userBId,companyId:candidate.companyId,jobPostId:candidate.jobId,initiatedBy:senderId,isColdOutreach:true},update:{updatedAt:new Date()}});
          const message=await tx.chatMessage.create({data:{conversationId:conversation.id,senderId,body:row.subject+'\n\n'+row.body}});
          await tx.candidateMessage.update({where:{id},data:{recipientUserId:recipient.id,messageId:message.id,messageStatus:'SENT'}});
          return [senderId,recipient.id];
        });
        if(participants)this.live?.publish(participants,'chat');
      }else await this.db.candidateMessage.updateMany({where:{id,messageId:null,messageStatus:{in:['PENDING','FAILED']}},data:{messageStatus:'WAITING_ACCOUNT'}});
    }
    if(row.emailStatus==='SENDING'){await this.db.candidateMessage.updateMany({where:{id,emailStatus:'SENDING'},data:{emailStatus:'UNCERTAIN',error:'Status email belum terkonfirmasi. Periksa sebelum mengirim ulang.'}});return;}
    if(!['PENDING','FAILED'].includes(row.emailStatus))return;
    const claimed=await this.db.candidateMessage.updateMany({where:{id,emailStatus:{in:['PENDING','FAILED']}},data:{emailStatus:'SENDING',emailAttemptAt:new Date(),error:null}});if(!claimed.count)return;
    const sent=await this.mail.send(row.recipientEmail,row.subject,'<p>'+escapeHtml(row.body).replace(/\n/g,'<br>')+'</p>');
    await this.db.candidateMessage.updateMany({where:{id,emailStatus:'SENDING'},data:sent?{emailStatus:'SENT',emailSentAt:new Date(),error:null}:{emailStatus:'UNCERTAIN',error:'Status email belum terkonfirmasi. Periksa sebelum mengirim ulang.'}});
  }
  async retry(user:AuthUser,id:string,acknowledgePossibleDuplicate=false){
    const row=await this.db.candidateMessage.findUnique({where:{id}});if(!row)throw new NotFoundException();await this.candidates.owned(user,row.candidateId);
    if(['SENDING','UNCERTAIN'].includes(row.emailStatus)&&!acknowledgePossibleDuplicate)throw new ConflictException('Konfirmasikan kemungkinan email ganda sebelum mengirim ulang.');
    if(!['FAILED','UNCERTAIN'].includes(row.emailStatus)&&row.messageStatus!=='FAILED')throw new BadRequestException('Pesan ini tidak memerlukan pengiriman ulang.');
    await this.db.$transaction(async tx=>{await tx.$queryRaw(Prisma.sql`SELECT id FROM "CandidateMessage" WHERE id=${id} FOR UPDATE`);const current=await tx.candidateMessage.findUniqueOrThrow({where:{id}});if(await tx.aiScreeningWork.count({where:{kind:'CANDIDATE_DELIVERY',subjectId:id,status:'RUNNING',leaseUntil:{gt:new Date()}}}))throw new ConflictException('Pengiriman masih berjalan. Periksa kembali sebentar lagi.');if(['SENDING','UNCERTAIN'].includes(current.emailStatus)&&!acknowledgePossibleDuplicate)throw new ConflictException('Konfirmasikan kemungkinan email ganda sebelum mengirim ulang.');await tx.candidateMessage.update({where:{id},data:{emailStatus:['FAILED','UNCERTAIN'].includes(current.emailStatus)?'PENDING':current.emailStatus,error:null}});const work=await enqueueWork(tx,'CANDIDATE_DELIVERY',id);await tx.aiScreeningWork.update({where:{id:work.id},data:{status:'PENDING',attempts:0,availableAt:new Date(),error:null,leaseOwner:null,leaseUntil:null}});});
    return {status:'PENDING'};
  }
  async retryBatch(user:AuthUser,id:string,acknowledgePossibleDuplicate=false){const batch=await this.batch(user,id);const rows=await this.db.candidateMessage.findMany({where:{batchId:batch.id,OR:[{emailStatus:{in:['FAILED','UNCERTAIN']}},{messageStatus:'FAILED'}]},select:{id:true,emailStatus:true}});if(!acknowledgePossibleDuplicate&&rows.some(row=>row.emailStatus==='UNCERTAIN'))throw new ConflictException('Konfirmasikan kemungkinan email ganda sebelum mengirim ulang.');for(const row of rows)await this.retry(user,row.id,acknowledgePossibleDuplicate);return {count:rows.length};}
  async reconcile(){
    const rows=await this.db.candidateMessage.findMany({where:{messageStatus:'WAITING_ACCOUNT',candidate:{scoreStatus:{not:'ERASED'},stage:{not:'WITHDRAWN'}}},orderBy:{id:'asc'},take:100,...(this.waitingCursor?{cursor:{id:this.waitingCursor},skip:1}:{})});
    this.waitingCursor=rows.length===100?rows.at(-1)!.id:undefined;
    if(!rows.length)return;
    const accounts=await this.db.user.findMany({where:{...activeAccount,role:'EMPLOYEE',emailVerified:true,OR:rows.map(r=>({email:{equals:r.recipientEmail,mode:'insensitive' as const}}))},select:{email:true}}),emails=new Set(accounts.map(a=>a.email?.toLowerCase()));
    for(const row of rows)if(emails.has(row.recipientEmail.toLowerCase()))await enqueueWork(this.db,'CANDIDATE_DELIVERY',row.id,'CANDIDATE_DELIVERY:'+row.id+':account');
  }
  async failure(id:string){await this.db.candidateMessage.updateMany({where:{id,messageStatus:{in:['PENDING','FAILED']}},data:{messageStatus:'FAILED',error:'Pesan tersimpan. Pengiriman perlu dicoba ulang.'}});}

  private async appointmentMessage(tx:Prisma.TransactionClient,user:AuthUser,candidate:Candidate,interview:{id:string;revision:number;scheduledAt:Date;durationMins:number;location:string|null;meetingUrl:string|null;status:string},email?:string){
    const recipient=this.recipient(candidate,email),cancelled=interview.status==='CANCELLED',subject=(cancelled?'Pembatalan interview':'Jadwal interview')+' — '+candidate.job!.title;
    const body=cancelled?`Halo ${candidate.fullName}, jadwal interview untuk ${candidate.job!.title} pada ${interview.scheduledAt.toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB telah dibatalkan. Tim HR akan menghubungimu untuk langkah selanjutnya.`:`Halo ${candidate.fullName}, kamu diundang interview untuk ${candidate.job!.title}.\nWaktu: ${interview.scheduledAt.toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB\nDurasi: ${interview.durationMins} menit\n${interview.meetingUrl?'Tautan: '+interview.meetingUrl+'\n':''}${interview.location?'Lokasi: '+interview.location+'\n':''}\nHubungi tim HR melalui Pesan Talentio jika perlu mengubah jadwal.`;
    const batch=await tx.candidateMessageBatch.create({data:{companyId:candidate.companyId,createdById:user.id,requestKey:'interview:'+interview.id+':'+interview.revision,inputHash:hash([interview,recipient]),subject,bodyTemplate:body}});
    const message=await tx.candidateMessage.create({data:{batchId:batch.id,candidateId:candidate.id,interviewId:interview.id,interviewRevision:interview.revision,recipientEmail:recipient.email,recipientUserId:recipient.userId,subject,body,kind:'INTERVIEW',emailStatus:recipient.email?'PENDING':'NO_EMAIL'}});
    await enqueueWork(tx,'CANDIDATE_DELIVERY',message.id);
  }
  async interviews(user:AuthUser,candidateId:string){const candidate=await this.candidates.owned(user,candidateId);const rows=await this.db.candidateInterview.findMany({where:{candidateId},include:{nativeInterview:true},orderBy:{scheduledAt:'asc'}}),legacy=candidate.applicationId?await this.db.interview.findMany({where:{applicationId:candidate.applicationId,recruitmentInterview:null},orderBy:{scheduledAt:'asc'}}):[];return [...rows.map(({nativeInterview,...row})=>({...row,nativeOnly:false,...(nativeInterview?{status:nativeInterview.status,scheduledAt:nativeInterview.scheduledAt,durationMins:nativeInterview.durationMins,meetingUrl:nativeInterview.meetingUrl,location:nativeInterview.location,note:nativeInterview.note}:{})})),...legacy.map(row=>({...row,id:'native:'+row.id,revision:0,nativeOnly:true}))].sort((a,b)=>+a.scheduledAt-+b.scheduledAt);}
  async schedule(user:AuthUser,candidateId:string,input:z.infer<typeof candidateInterviewSchema>){
    await this.candidates.owned(user,candidateId);
    if(Date.parse(input.scheduledAt)<=Date.now())throw new BadRequestException('Pilih waktu interview di masa mendatang.');
    const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "RecruitmentCandidate" WHERE id=${candidateId} FOR UPDATE`);
      const candidate=await tx.recruitmentCandidate.findUniqueOrThrow({where:{id:candidateId},include:contextInclude});this.assertCandidate(candidate);
      const existing=await tx.candidateInterview.findUnique({where:{candidateId_requestKey:{candidateId,requestKey:input.requestKey}}});if(existing){if(+existing.scheduledAt!==Date.parse(input.scheduledAt)||existing.durationMins!==input.durationMins||existing.location!==(input.location??null)||existing.meetingUrl!==(input.meetingUrl??null)||existing.note!==(input.note??null))throw new ConflictException('Kunci jadwal sudah digunakan.');return existing;}
      if(['OFFER','HIRED','REJECTED'].includes(candidate.stage))throw new BadRequestException('Tahap kandidat sudah selesai atau dalam penawaran.');
      this.recipient(candidate,input.email);
      if(candidate.applicationId){await tx.$queryRaw(Prisma.sql`SELECT id FROM "Application" WHERE id=${candidate.applicationId} FOR UPDATE`);const app=await tx.application.findUniqueOrThrow({where:{id:candidate.applicationId}});if(['OFFER','HIRED','REJECTED','WITHDRAWN'].includes(app.status))throw new ConflictException('Tahap lamaran berubah. Perbarui data kandidat.');await tx.application.update({where:{id:app.id},data:{status:'INTERVIEW',kanbanEnteredAt:new Date()}});if(app.status!=='INTERVIEW')await tx.pipelineEvent.create({data:{applicationId:app.id,fromStatus:app.status,toStatus:'INTERVIEW',actorUserId:user.id,note:'Interview dijadwalkan melalui daftar kandidat.'}});}
      const details={scheduledAt:new Date(input.scheduledAt),durationMins:input.durationMins,location:input.location??null,meetingUrl:input.meetingUrl??null,note:input.note??null};
      const native=candidate.applicationId?await tx.interview.create({data:{applicationId:candidate.applicationId,...details}}):null;
      const row=await tx.candidateInterview.create({data:{candidateId,nativeInterviewId:native?.id,requestKey:input.requestKey,createdById:user.id,...details}});
      await tx.recruitmentCandidate.update({where:{id:candidateId},data:{stage:'INTERVIEW',enteredProcessAt:new Date()}});
      await tx.candidateActivity.create({data:{candidateId,actorUserId:user.id,kind:'INTERVIEW_SCHEDULED',detail:json({interviewId:row.id,scheduledAt:row.scheduledAt})}});
      await this.appointmentMessage(tx,user,candidate,row,input.email);return row;
    });
    this.live?.publish([user.id],'applications');return result;
  }
  async updateInterview(user:AuthUser,candidateId:string,id:string,input:z.infer<typeof candidateInterviewUpdateSchema>){
    await this.candidates.owned(user,candidateId);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "RecruitmentCandidate" WHERE id=${candidateId} FOR UPDATE`);
      const candidate=await tx.recruitmentCandidate.findUniqueOrThrow({where:{id:candidateId},include:contextInclude});this.assertCandidate(candidate);
      const row=await tx.candidateInterview.findFirst({where:{id,candidateId},include:{nativeInterview:true}});if(!row)throw new NotFoundException();
      if(row.revision!==input.revision)throw new ConflictException('Jadwal telah berubah. Muat ulang sebelum menyimpan.');
      if((row.nativeInterview?.status??row.status)!=='SCHEDULED')throw new ConflictException('Jadwal ini sudah selesai atau dibatalkan.');
      const scheduledAt=input.scheduledAt?new Date(input.scheduledAt):row.scheduledAt;
      if(input.status==='SCHEDULED'&&+scheduledAt<=Date.now())throw new BadRequestException('Pilih waktu interview di masa mendatang.');
      const location=input.location===undefined?row.location:input.location,meetingUrl=input.meetingUrl===undefined?row.meetingUrl:input.meetingUrl;
      if(input.status==='SCHEDULED'&&!location&&!meetingUrl)throw new BadRequestException('Lengkapi lokasi atau tautan meeting.');
      const update={status:input.status,scheduledAt,durationMins:input.durationMins??row.durationMins,location,meetingUrl,note:input.note===undefined?row.note:input.note};
      if(row.nativeInterviewId){await tx.$queryRaw(Prisma.sql`SELECT id FROM "Interview" WHERE id=${row.nativeInterviewId} FOR UPDATE`);const native=await tx.interview.findUniqueOrThrow({where:{id:row.nativeInterviewId}});if(native.status!=='SCHEDULED')throw new ConflictException('Jadwal telah berubah melalui detail lamaran.');await tx.interview.update({where:{id:native.id},data:update});}
      const current=await tx.candidateInterview.update({where:{id},data:{...update,revision:{increment:1}}});
      await tx.candidateActivity.create({data:{candidateId,actorUserId:user.id,kind:input.status==='SCHEDULED'?'INTERVIEW_RESCHEDULED':input.status==='CANCELLED'?'INTERVIEW_CANCELLED':'INTERVIEW_COMPLETED',detail:json({interviewId:id,scheduledAt})}});
      if(input.status!=='COMPLETED')await this.appointmentMessage(tx,user,candidate,current,(await tx.candidateMessage.findFirst({where:{interviewId:id},orderBy:{createdAt:'desc'},select:{recipientEmail:true}}))?.recipientEmail??undefined);
      return current;
    });
  }
}
