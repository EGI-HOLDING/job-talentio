import { scoringJob, scoreJobInclude, sameScoringJob } from './cv-job-context';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { json } from '../screening.policy';
import { CvAssessmentService } from './cv-assessment.service';
import { CV_RECOVERY_VERSION } from './cv-assessment';

@Injectable()
export class CvScoringService {
  constructor(private db: PrismaService, private recovery: CvAssessmentService) {}
  async process(workId: string, id: string, owner: string) {
    let work = await this.db.aiScreeningWork.findUniqueOrThrow({ where: { id: workId } });
    if (work.leaseOwner !== owner || work.status !== 'RUNNING' || work.kind !== 'CV_SCORE' || work.subjectId !== id) return;
    if (work.cvPolicy !== CV_RECOVERY_VERSION) {
      // Only work that never contacted a provider can be promoted in place.
      if (await this.db.aiScreeningCall.count({ where: { workId } })) throw new Error('CV_RETIRED_WORK_REQUIRES_REVIEW');
      const promoted = await this.db.aiScreeningWork.updateMany({ where: { id: workId, leaseOwner: owner,
        status: 'RUNNING', cvPolicy: null }, data: { cvPolicy: CV_RECOVERY_VERSION } });
      if (!promoted.count) throw new Error('CV_RETIRED_WORK_REQUIRES_REVIEW');
      work = await this.db.aiScreeningWork.findUniqueOrThrow({ where: { id: workId } });
    }
    const row = await this.db.recruitmentCandidate.findUnique({ where: { id } });
    const expected=work?.key.startsWith('CV_SCORE:'+id+':')?Number(work.key.slice(('CV_SCORE:'+id+':').length)):0;
    if (!row || !row.fileKey || !['PENDING','PROCESSING'].includes(row.scoreStatus) || (work && expected !== row.revision)) {
      await this.recovery.supersede(workId, owner);
      return;
    }
    if(row.jobId){const job=await this.db.jobPost.findUniqueOrThrow({where:{id:row.jobId},include:scoreJobInclude});
      if(!sameScoringJob(row.jobSnapshot,scoringJob(job))){
        await this.db.recruitmentCandidate.updateMany({where:{id,revision:row.revision},data:{scoreStatus:'STALE',cvScore:null,cvProgress:Prisma.DbNull,revision:{increment:1},error:'Kriteria lowongan berubah. Nilai ulang CV dengan kriteria terbaru.'}});
        await this.recovery.supersede(workId, owner);
        return;
      }}
    const company = await this.db.company.findUnique({ where: { id: row.companyId }, select: { anonymizedAt: true, isBanned: true } });
    if (!company || company.anonymizedAt || company.isBanned) throw Error('COMPANY_UNAVAILABLE');
    const claim=await this.db.recruitmentCandidate.updateMany({where:{id,revision:row.revision,scoreStatus:{in:['PENDING','PROCESSING']}},data:{scoreStatus:'PROCESSING',error:null}});
    if(!claim.count)return;
    if (row.scoreStatus === 'PENDING') await this.db.candidateActivity.create({ data: { candidateId: id, kind: 'CV_SCORING_STARTED', detail: json({ workId, revision: row.revision }) } });
    return this.recovery.process(work, owner, row);
  }
  async failure(id: string, error: string, workKey?:string) {
    await this.db.recruitmentCandidate.updateMany({ where: { id, ...(workKey?{revision:workKey.startsWith('CV_SCORE:'+id+':')?Number(workKey.slice(('CV_SCORE:'+id+':').length)):0}:{}), scoreStatus: { in: ['PENDING','PROCESSING'] } }, data: {
      scoreStatus: 'FAILED', cvScore: null, cvProgress: json({ phase: 'RECOVERING', updatedAt: new Date().toISOString() }),
      error: 'Proses AI memerlukan pemeriksaan operator. CV tetap tersimpan.',
    } });
  }
}
