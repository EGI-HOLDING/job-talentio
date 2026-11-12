import { assertNoUnresolvedCvSubmission, enqueueCvAssessment, retryCvAssessmentV2, type CvOperatorAction } from './cv-score-recovery';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { CompaniesService } from '../../companies/companies.service';
import type { AuthUser } from '../../common/auth.decorators';
import { hash, json } from '../screening.policy';
import { candidateBulkSchema, candidateImportSchema, candidateListSchema, type CandidateList } from './recruitment.schemas';
import { CV_MAX_BYTES, fileChecksum, validateCvBytes } from './cv-scoring.policy';
import { CV_ALERT_MS, CV_RECOVERY_VERSION } from './cv-assessment';

const safeSelect = { id: true, companyId: true, jobId: true, applicationId: true, importId: true, importFileId: true,
  filename: true, sizeBytes: true, contentType: true, fullName: true, email: true, phone: true, headline: true,
  stage: true, enteredProcessAt: true, scoreStatus: true, cvScore: true, cvProgress: true, error: true, revision: true, createdAt: true,
  assignedTo: { select: { id: true, fullName: true } }, job: { select: { id: true, title: true } },
  interviews:{where:{status:'SCHEDULED',nativeInterviewId:null},orderBy:{scheduledAt:'asc'},take:1,select:{id:true,scheduledAt:true,meetingUrl:true}},
  application: { select: { interviews: { where: { status: 'SCHEDULED' }, orderBy: { scheduledAt: 'asc' }, take: 1, select: { id: true, scheduledAt: true, meetingUrl: true } } } },
} satisfies Prisma.RecruitmentCandidateSelect;
export { scoringJob, scoreJobInclude } from './cv-job-context';
import { scoringJob, scoreJobInclude } from './cv-job-context';
@Injectable()
export class RecruitmentService {
  constructor(private db: PrismaService, private storage: StorageService, private companies: CompaniesService) {}
  async access(user: AuthUser, companyId: string) {
    const membership = await this.companies.assertMember(user, companyId);
    this.companies.assertOpen(membership.company);
  }
  async members(user: AuthUser, companyId: string) {
    await this.access(user,companyId);
    return this.db.companyMember.findMany({where:{companyId,user:{isBanned:false,anonymizedAt:null}},select:{user:{select:{id:true,fullName:true}}},orderBy:{createdAt:'asc'}});
  }
  async jobs(user:AuthUser,companyId:string){await this.access(user,companyId);return this.db.jobPost.findMany({where:{companyId},select:{id:true,title:true,status:true},orderBy:{updatedAt:'desc'}});}
  async cvStatus(user: AuthUser, companyId: string, ids: string[]) {
    await this.access(user, companyId);
    return this.db.recruitmentCandidate.findMany({ where: { companyId, id: { in: ids } },
      select: { id: true, revision: true, scoreStatus: true, cvScore: true, cvProgress: true, error: true } });
  }
  async owned(user: AuthUser, id: string) {
    const row = await this.db.recruitmentCandidate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Kandidat tidak ditemukan.');
    await this.access(user, row.companyId);
    return row;
  }
  async createImport(user: AuthUser, input: z.infer<typeof candidateImportSchema>) {
    await this.access(user, input.companyId);
    const job = input.jobId ? await this.db.jobPost.findFirst({ where: { id: input.jobId, companyId: input.companyId }, include: scoreJobInclude }) : null;
    if (input.jobId && !job) throw new NotFoundException('Lowongan tidak ditemukan.');
    const batch = await this.db.$transaction(async tx => {
      const previous = await tx.candidateImport.findUnique({ where: { companyId_requestKey: { companyId: input.companyId, requestKey: input.requestKey } }, include: { candidates: true } });
      if (previous) {
        if (previous.jobId !== (input.jobId ?? null) || previous.candidates.length !== input.files.length || previous.candidates.some(c => !input.files.some(f => f.clientId === c.importFileId && f.filename === c.filename && f.size === c.sizeBytes))) throw new ConflictException('Kunci upload sudah digunakan untuk berkas lain.');
        return previous;
      }
      return tx.candidateImport.create({ data: { companyId: input.companyId, jobId: input.jobId, requestKey: input.requestKey, createdById: user.id,
        candidates: { create: input.files.map(f => ({ companyId: input.companyId, jobId: input.jobId, filename: f.filename, fullName: f.filename.replace(/\.[^.]+$/, ''), sizeBytes: f.size, contentType: f.contentType,
          importFileId: f.clientId, uploadKey: 'cvs/import-pending/' + randomUUID(), jobSnapshot: job ? json(scoringJob(job)) : Prisma.DbNull, scoringVersion: CV_RECOVERY_VERSION })) } }, include: { candidates: true } });
    });
    return { id: batch.id, files: await Promise.all(batch.candidates.map(async c => ({ id: c.id, clientId: c.importFileId, status: c.scoreStatus,
      uploadUrl: c.scoreStatus === 'UPLOADING' && c.uploadKey ? await this.storage.getPresignedPutUrl(c.uploadKey, c.contentType) : null }))) };
  }
  async importState(user: AuthUser, id: string) {
    const batch = await this.db.candidateImport.findUnique({ where: { id }, include: { candidates: { select: safeSelect } } });
    if (!batch) throw new NotFoundException();
    await this.access(user, batch.companyId);
    return { id: batch.id, companyId: batch.companyId, jobId: batch.jobId, files: batch.candidates };
  }
  async uploadUrl(user: AuthUser, id: string) {
    const row = await this.owned(user, id);
    if (row.scoreStatus !== 'UPLOADING' || !row.uploadKey) return { uploadUrl: null, status: row.scoreStatus };
    return { uploadUrl: await this.storage.getPresignedPutUrl(row.uploadKey, row.contentType), status: row.scoreStatus };
  }
  async completeUpload(user: AuthUser, id: string) {
    const candidate = await this.owned(user, id);
    if (candidate.scoreStatus !== 'UPLOADING') return this.detail(user, id);
    if (!candidate.uploadKey) throw new BadRequestException('Upload belum tersedia.');
    let buffer: Buffer, contentType: string;
    try {
      buffer = await this.storage.getObjectBuffer(candidate.uploadKey, CV_MAX_BYTES);
      contentType = validateCvBytes(buffer, candidate.filename);
      if (buffer.length !== candidate.sizeBytes) throw Error('INCOMPLETE_UPLOAD');
    } catch { throw new BadRequestException('Berkas belum lengkap atau format CV tidak valid. Coba upload ulang.'); }
    const checksum = fileChecksum(buffer), dedupeKey = hash([candidate.companyId, candidate.jobId, checksum]);
    const duplicate = await this.db.recruitmentCandidate.findUnique({ where: { dedupeKey } });
    if (duplicate && duplicate.id !== id) {
      await this.db.recruitmentCandidate.updateMany({ where: { id, scoreStatus: 'UPLOADING' }, data: { scoreStatus: 'DUPLICATE', error: 'CV sudah tersedia dalam kumpulan kandidat ini.', uploadKey: null } });
      await this.storage.delete(candidate.uploadKey);
      return { duplicateOf: duplicate.id, ...await this.detail(user, id) };
    }
    // Seal the file under a fresh key. The still-valid upload URL cannot replace an assessed CV.
    const fileKey = 'cvs/recruitment/' + candidate.companyId + '/' + randomUUID() + '/' + candidate.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    await this.storage.putObject(fileKey, buffer, contentType);
    let kept = false;
    try {
      kept = await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id=${candidate.companyId} FOR UPDATE`);
        const current=await tx.recruitmentCandidate.findUniqueOrThrow({where:{id}});
        const currentJob=current.jobId?await tx.jobPost.findUniqueOrThrow({where:{id:current.jobId},include:scoreJobInclude}):null;
        const claimed = await tx.recruitmentCandidate.updateMany({ where: { id, scoreStatus: 'UPLOADING' }, data: { fileKey, checksum, contentType, dedupeKey, uploadKey: null, scoreStatus: 'PENDING', error: null, ...(currentJob?{jobSnapshot:json(scoringJob(currentJob))}:{}) } });
        if (!claimed.count) return false;
        await enqueueCvAssessment(tx, current);
        await tx.candidateActivity.create({ data: { candidateId: id, actorUserId: user.id, kind: 'CV_RECEIVED' } });
        return true;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.db.recruitmentCandidate.updateMany({ where: { id, scoreStatus: 'UPLOADING' }, data: { scoreStatus: 'DUPLICATE', error: 'CV sudah tersedia dalam kumpulan kandidat ini.', uploadKey: null } });
      } else throw error;
    } finally { if (!kept) await this.storage.delete(fileKey); }
    await this.storage.delete(candidate.uploadKey);
    return this.detail(user, id);
  }
  async captureApplication(applicationId: string) {
    const app = await this.db.application.findUnique({ where: { id: applicationId }, include: { profile: { include: { user: true } }, jobPost: { include: scoreJobInclude }, resumeVersion: true } });
    if (!app) return;
    const existing = await this.db.recruitmentCandidate.findUnique({ where: { applicationId } });
    if (existing) return existing;
    const snapshot = app.resumeSnapshot as { fileKey?: string; title?: string } | null;
    const fileKey = app.resumeVersion?.fileKey ?? snapshot?.fileKey;
    return this.db.$transaction(async tx => {
      const row = await tx.recruitmentCandidate.upsert({ where: { applicationId }, update: {}, create: {
        applicationId, companyId: app.jobPost.companyId, jobId: app.jobPostId, fullName: app.profile.user.fullName, email: app.profile.user.email,
        headline: app.profile.headline ?? '', filename: snapshot?.title ?? fileKey?.split('/').at(-1) ?? 'CV.pdf',
        contentType: fileKey?.toLowerCase().endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : fileKey?.toLowerCase().endsWith('.doc') ? 'application/msword' : 'application/pdf',
        fileKey, sizeBytes: 0, checksum: app.resumeVersion?.checksum, stage: app.status, enteredProcessAt: app.kanbanEnteredAt,
        scoreStatus: fileKey ? 'PENDING' : 'FAILED', error: fileKey ? null : 'CV tidak tersedia.', jobSnapshot: json(scoringJob(app.jobPost)), scoringVersion: CV_RECOVERY_VERSION, createdAt: app.createdAt,
        activities: { create: { kind: 'APPLICATION_RECEIVED' } },
      } });
      if (fileKey) await enqueueCvAssessment(tx, row);
      return row;
    });
  }
  where(input: CandidateList): Prisma.RecruitmentCandidateWhereInput {
    const stages = input.phase === 'review' ? ['NEW'] : input.phase === 'progress' ? ['IN_REVIEW','INTERVIEW','OFFER'] : input.phase === 'finished' ? ['HIRED','REJECTED','WITHDRAWN'] : undefined;
    return { companyId: input.companyId, jobId: input.jobId ?? null, scoreStatus: { not: 'DUPLICATE' },
      ...(input.stage ? { stage: input.stage } : {}),
      ...(stages ? { AND: { stage: { in: stages as Array<'NEW'|'IN_REVIEW'|'INTERVIEW'|'OFFER'|'HIRED'|'REJECTED'|'WITHDRAWN'> } } } : {}),
      ...(input.q.trim() ? { OR: [{ fullName: { contains: input.q.trim(), mode: 'insensitive' } }, { email: { contains: input.q.trim(), mode: 'insensitive' } }, { headline: { contains: input.q.trim(), mode: 'insensitive' } }] } : {}) };
  }
  async list(user: AuthUser, input: z.infer<typeof candidateListSchema>) {
    await this.access(user, input.companyId);
    // Application remains authoritative for candidate withdrawal and offer acceptance.
    await this.db.$executeRaw(Prisma.sql`UPDATE "RecruitmentCandidate" c SET "stage"=a."status", "enteredProcessAt"=a."kanbanEnteredAt", "updatedAt"=NOW()
      FROM "Application" a WHERE c."applicationId"=a."id" AND c."companyId"=${input.companyId}
      AND c."stage" IS DISTINCT FROM a."status"`);
    if (input.jobId) {
      const job = await this.db.jobPost.findFirst({ where: { id: input.jobId, companyId: input.companyId }, select: { id: true } });
      if (!job) throw new NotFoundException();
      const missing = await this.db.application.findMany({ where: { jobPostId: input.jobId, recruitmentCandidate: null }, select: { id: true }, take: 100, orderBy: { id: 'asc' } });
      for (const app of missing) await this.captureApplication(app.id);
    }
    const where = this.where(input), total = await this.db.recruitmentCandidate.count({ where });
    const page = Math.max(1, Math.min(input.page, Math.ceil(total / input.limit) || 1));
    const base = this.where({ ...input, phase: 'all', stage: undefined });
    const select={...safeSelect,interviews:{...safeSelect.interviews,where:{status:'SCHEDULED' as const,nativeInterviewId:null,scheduledAt:{gte:new Date()}}},application:{select:{interviews:{...safeSelect.application.select.interviews,where:{status:'SCHEDULED' as const,scheduledAt:{gte:new Date()}}}}}};
    const scheduled=input.sort==='schedule'?await this.db.recruitmentCandidate.findMany({where,select:{id:true,interviews:{where:{status:'SCHEDULED',nativeInterviewId:null,scheduledAt:{gte:new Date()}},orderBy:{scheduledAt:'asc'},take:1,select:{scheduledAt:true}},application:{select:{interviews:{where:{status:'SCHEDULED',scheduledAt:{gte:new Date()}},orderBy:{scheduledAt:'asc'},take:1,select:{scheduledAt:true}}}}}}):null;
    const nearest=(row:NonNullable<typeof scheduled>[number])=>Math.min(row.interviews[0]?.scheduledAt.getTime()??Infinity,row.application?.interviews[0]?.scheduledAt.getTime()??Infinity);
    const scheduledIds=scheduled?.sort((a,b)=>nearest(a)-nearest(b)||a.id.localeCompare(b.id)).slice((page-1)*input.limit,page*input.limit).map(r=>r.id);
    const [items, all, review, progress, finished, overallTotal] = await this.db.$transaction([
      this.db.recruitmentCandidate.findMany({ where:scheduledIds?{...where,id:{in:scheduledIds}}:where, select, orderBy: input.sort === 'score' ? [{ cvScore: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }], ...(scheduledIds?{}:{skip: (page - 1) * input.limit, take: input.limit}) }),
      this.db.recruitmentCandidate.count({ where: base }),
      this.db.recruitmentCandidate.count({ where: { ...base, stage: 'NEW' } }),
      this.db.recruitmentCandidate.count({ where: { ...base, stage: { in: ['IN_REVIEW','INTERVIEW','OFFER'] } } }),
      this.db.recruitmentCandidate.count({ where: { ...base, stage: { in: ['HIRED','REJECTED','WITHDRAWN'] } } }),
      this.db.recruitmentCandidate.count({where:this.where({...input,q:'',phase:'all',stage:undefined})}),
    ]);
    const counts = { all, review, progress, finished };
    return { items:scheduledIds?scheduledIds.map(id=>items.find(r=>r.id===id)!).filter(Boolean):items, overallTotal,total, page, limit: input.limit, counts, hasMoreToImport: input.jobId ? await this.db.application.count({ where: { jobPostId: input.jobId, recruitmentCandidate: null } }) > 0 : false };
  }
  async detail(user: AuthUser, id: string) {
    await this.owned(user, id);
    return this.db.recruitmentCandidate.findUniqueOrThrow({ where: { id }, select: { ...safeSelect, cvResult: true, jobSnapshot: true, scoringVersion: true,
      activities: { orderBy: { createdAt: 'desc' }, take: 100 }, application: { select: { interviews: { orderBy: { scheduledAt: 'asc' } }, screeningSession: { select: { id: true, status: true, completedAt: true, evaluation: { select: { status: true, screeningScore: true, result: true } } } } } } } });
  }
  async applicationCandidate(user:AuthUser,jobId:string,applicationId:string){
    const app=await this.db.application.findFirst({where:{id:applicationId,jobPostId:jobId},select:{jobPost:{select:{companyId:true}}}});
    if(!app)throw new NotFoundException('Lamaran tidak ditemukan dalam lowongan ini.');
    await this.access(user,app.jobPost.companyId);await this.captureApplication(applicationId);
    const row=await this.db.recruitmentCandidate.findUnique({where:{applicationId},select:{id:true}});
    if(!row)throw new NotFoundException('Kandidat tidak lagi tersedia.');return this.detail(user,row.id);
  }
  async download(user: AuthUser, id: string) {
    const row = await this.owned(user, id);
    if (!row.fileKey) throw new NotFoundException('CV belum selesai diupload.');
    return { url: await this.storage.getPresignedGetUrl(row.fileKey, 300, { filename: row.filename, contentType: row.contentType }) };
  }
  async retry(user: AuthUser, id: string) {
    const row = await this.owned(user, id);
    return this.db.$transaction(async tx => {
      if (row.fileKey) {
        const v2 = await retryCvAssessmentV2(tx, row, user.id);
        if (v2) return v2;
      }
      if (!row.fileKey || !['FAILED','UNREADABLE','STALE'].includes(row.scoreStatus)) throw new BadRequestException('CV ini belum dapat diproses ulang.');
      await assertNoUnresolvedCvSubmission(tx, row.id);
      const job=row.jobId?await tx.jobPost.findUniqueOrThrow({where:{id:row.jobId},include:scoreJobInclude}):null;
      const claim = await tx.recruitmentCandidate.updateMany({ where: { id, revision: row.revision, scoreStatus: row.scoreStatus }, data: { scoreStatus: 'PENDING', cvScore:null, cvProgress: Prisma.DbNull, ...(job?{jobSnapshot:json(scoringJob(job))}:{}), error: null, revision: { increment: 1 } } });
      if (!claim.count) throw new ConflictException('Proses ulang sudah dimulai.');
      await enqueueCvAssessment(tx, { ...row, revision: row.revision + 1 });
      await tx.candidateActivity.create({ data: { candidateId: id, actorUserId: user.id, kind: 'CV_RETRY' } });
      return { status: 'PENDING' };
    });
  }
  async recoverCv(user: AuthUser, id: string, operation: CvOperatorAction) {
    if (user.role !== 'SUPER_ADMIN') throw new NotFoundException();
    const row = await this.db.recruitmentCandidate.findUnique({ where: { id } });
    if (!row?.fileKey) throw new NotFoundException();
    const result = await this.db.$transaction(tx => retryCvAssessmentV2(tx, row, user.id, operation));
    if (!result) throw new NotFoundException('Penilaian CV tidak tersedia untuk pemulihan.');
    return result;
  }
  async cvRecoveryQueue(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new NotFoundException();
    return this.db.aiScreeningWork.findMany({ where: { cvPolicy: CV_RECOVERY_VERSION, OR: [
      { status: 'FAILED', error: { notIn: ['CV_FILE_INVALID', 'CV_DOCUMENT_UNREADABLE'] } },
      { status: { in: ['PENDING', 'RUNNING'] }, createdAt: { lte: new Date(Date.now() - CV_ALERT_MS) } },
    ] }, orderBy: { updatedAt: 'asc' }, take: 100,
      select: { id: true, subjectId: true, status: true, error: true, createdAt: true, updatedAt: true } });
  }
  async bulk(user: AuthUser, input: z.infer<typeof candidateBulkSchema>) {
    await this.access(user,input.companyId);
    if (input.action.kind==='assign' && input.action.userId) {
      const member=await this.db.companyMember.findUnique({where:{companyId_userId:{companyId:input.companyId,userId:input.action.userId}},include:{user:{select:{isBanned:true,anonymizedAt:true}}}});
      if(!member||member.user.isBanned||member.user.anonymizedAt)throw new BadRequestException('Penanggung jawab harus anggota aktif perusahaan ini.');
    }
    const selection=input.selection;
    if('filter' in selection&&selection.filter.companyId!==input.companyId)throw new BadRequestException('Filter perusahaan tidak sesuai.');
    return this.db.$transaction(async tx=>{
      const where:Prisma.RecruitmentCandidateWhereInput='ids' in selection?{companyId:input.companyId,id:{in:selection.ids}}:{...this.where(selection.filter),id:{notIn:selection.excludedIds}};
      const rows=await tx.recruitmentCandidate.findMany({where,select:{id:true,applicationId:true,stage:true}});
      const expected='ids' in selection?new Set(selection.ids).size:selection.expectedCount;
      if(rows.length!==expected)throw new ConflictException('Daftar kandidat berubah. Perbarui pilihan lalu coba lagi.');
      if(input.action.kind==='rescore'){
        const sources=await tx.recruitmentCandidate.findMany({where:{id:{in:rows.map(r=>r.id)}}});
        const eligible=sources.filter(r=>r.fileKey&&['STALE','FAILED','UNREADABLE'].includes(r.scoreStatus)&&
          (r.cvProgress as { phase?: string } | null)?.phase !== 'RECOVERING');
        if(!eligible.length)throw new BadRequestException('Tidak ada CV yang memerlukan penilaian ulang dalam pilihan ini.');
        for(const source of eligible){
          await assertNoUnresolvedCvSubmission(tx, source.id);
          const job=source.jobId?await tx.jobPost.findUniqueOrThrow({where:{id:source.jobId},include:scoreJobInclude}):null;
          const claimed=await tx.recruitmentCandidate.updateMany({where:{id:source.id,revision:source.revision,scoreStatus:source.scoreStatus},data:{scoreStatus:'PENDING',cvScore:null,cvProgress:Prisma.DbNull,error:null,revision:{increment:1},...(job?{jobSnapshot:json(scoringJob(job))}:{})}});
          if(!claimed.count)throw new ConflictException('Status penilaian berubah. Perbarui daftar kandidat.');
          await enqueueCvAssessment(tx, { ...source, revision: source.revision + 1 });
          await tx.candidateActivity.create({data:{candidateId:source.id,actorUserId:user.id,kind:'CV_RETRY'}});
        }return {count:eligible.length};
      }
      if(input.action.kind==='job'){
        const job=await tx.jobPost.findFirst({where:{id:input.action.jobId,companyId:input.companyId},include:scoreJobInclude});if(!job)throw new NotFoundException('Lowongan tidak ditemukan.');
        const sources=await tx.recruitmentCandidate.findMany({where:{id:{in:rows.map(r=>r.id)}}});
        if(sources.some(r=>r.jobId||!r.fileKey||!r.checksum||r.scoreStatus!=='EXTRACTED'))throw new BadRequestException('Pilih CV yang sudah selesai dibaca dari kumpulan CV perusahaan.');
        let count=0;
        for(const source of sources){const dedupeKey=hash([source.companyId,job.id,source.checksum]);const exists=await tx.recruitmentCandidate.findUnique({where:{dedupeKey}});if(exists)continue;
          const added=await tx.recruitmentCandidate.create({data:{companyId:source.companyId,jobId:job.id,filename:source.filename,contentType:source.contentType,sizeBytes:source.sizeBytes,fileKey:source.fileKey,checksum:source.checksum,dedupeKey,fullName:source.fullName,email:source.email,phone:source.phone,headline:source.headline,scoreStatus:'PENDING',scoringVersion:CV_RECOVERY_VERSION,jobSnapshot:json(scoringJob(job))}});
          await enqueueCvAssessment(tx, added);await tx.candidateActivity.create({data:{candidateId:added.id,actorUserId:user.id,kind:'CV_ADDED_TO_JOB',detail:json({poolCandidateId:source.id})}});count++;
        }return{count};
      }
      if(input.action.kind==='move'&&rows.some(row=>['OFFER','HIRED','REJECTED','WITHDRAWN'].includes(row.stage)))throw new BadRequestException('Kandidat dalam penawaran atau tahap selesai perlu ditindaklanjuti melalui detail kandidat.');
      const action=input.action;
      if(action.kind==='move'){
        const currentApplications=await tx.application.findMany({where:{id:{in:rows.map(r=>r.applicationId).filter((id):id is string=>Boolean(id))}},select:{id:true,status:true}});
        if(currentApplications.some(app=>['OFFER','HIRED','REJECTED','WITHDRAWN'].includes(app.status)))throw new ConflictException('Tahap lamaran berubah. Perbarui daftar kandidat sebelum melanjutkan.');
      }
      await tx.recruitmentCandidate.updateMany({where:{id:{in:rows.map(r=>r.id)}},data:action.kind==='move'?{stage:action.stage,enteredProcessAt:new Date()}:{assignedToId:action.userId}});
      if(action.kind==='move')for(const row of rows)if(row.applicationId&&row.stage!==action.stage){
        await tx.application.update({where:{id:row.applicationId},data:{status:action.stage,kanbanEnteredAt:new Date()}});
        await tx.pipelineEvent.create({data:{applicationId:row.applicationId,fromStatus:row.stage,toStatus:action.stage,actorUserId:user.id,note:'Tahap diperbarui melalui daftar kandidat.'}});
      }
      await tx.candidateActivity.createMany({data:rows.map(row=>({candidateId:row.id,actorUserId:user.id,kind:action.kind==='move'?'STAGE_CHANGED':'HR_ASSIGNED',detail:json(action)}))});
      return {count:rows.length};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
  }
}
