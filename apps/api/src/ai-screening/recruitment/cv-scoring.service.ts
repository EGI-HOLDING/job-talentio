import { scoringJob, scoreJobInclude, sameScoringJob } from './cv-job-context';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ScreeningClient } from '../screening.client';
import { composePrompt } from '../prompts/compose';
import { json } from '../screening.policy';
import { CV_MAX_BYTES, CV_RUBRIC, CV_SCORING_VERSION, fileChecksum, validateCvBytes, validateCvResult } from './cv-scoring.policy';
import { CvAssessmentService } from './cv-assessment.service';
import { CV_RECOVERY_VERSION } from './cv-assessment';
import { saveCvAssessment } from './cv-assessment-store';

@Injectable()
export class CvScoringService {
  constructor(private db: PrismaService, private storage: StorageService, private client: ScreeningClient, private config: ConfigService,
    @Optional() private recovery?: CvAssessmentService) {}
  async process(workId: string, id: string, owner?: string) {
    const work = await this.db.aiScreeningWork.findUnique({ where: { id: workId } });
    const row = await this.db.recruitmentCandidate.findUnique({ where: { id } });
    const expected=work?.key.startsWith('CV_SCORE:'+id+':')?Number(work.key.slice(('CV_SCORE:'+id+':').length)):0;
    const v2 = work?.cvPolicy === CV_RECOVERY_VERSION;
    if (!row || !row.fileKey || !['PENDING','PROCESSING'].includes(row.scoreStatus) || (work && expected !== row.revision)) {
      if (v2) await this.recovery?.supersede(workId, owner);
      return;
    }
    if(row.jobId){const job=await this.db.jobPost.findUniqueOrThrow({where:{id:row.jobId},include:scoreJobInclude});
      if(!sameScoringJob(row.jobSnapshot,scoringJob(job))){
        await this.db.recruitmentCandidate.updateMany({where:{id,revision:row.revision},data:{scoreStatus:'STALE',cvScore:null,cvProgress:Prisma.DbNull,revision:{increment:1},error:'Kriteria lowongan berubah. Nilai ulang CV dengan kriteria terbaru.'}});
        if (v2) await this.recovery?.supersede(workId, owner);
        return;
      }}
    const company = await this.db.company.findUnique({ where: { id: row.companyId }, select: { anonymizedAt: true, isBanned: true } });
    if (!company || company.anonymizedAt || company.isBanned) throw Error('COMPANY_UNAVAILABLE');
    const claim=await this.db.recruitmentCandidate.updateMany({where:{id,revision:row.revision,scoreStatus:{in:['PENDING','PROCESSING']}},data:{scoreStatus:'PROCESSING',error:null}});
    if(!claim.count)return;
    if (row.scoreStatus === 'PENDING') await this.db.candidateActivity.create({ data: { candidateId: id, kind: 'CV_SCORING_STARTED', detail: json({ workId, revision: row.revision }) } });
    if (v2) {
      if (!this.recovery || !owner) throw new Error('CV_V2_WORKER_REQUIRED');
      return this.recovery.process(work, owner, row);
    }

    const buffer = await this.storage.getObjectBuffer(row.fileKey, CV_MAX_BYTES);
    const extension = row.fileKey.split('.').at(-1)?.toLowerCase();
    const filename = /\.(pdf|docx?)$/i.test(row.filename) ? row.filename : row.filename + '.' + (['pdf','doc','docx'].includes(extension ?? '') ? extension : 'pdf');
    const contentType = validateCvBytes(buffer, filename), checksum = fileChecksum(buffer);
    if (row.checksum && row.checksum !== checksum) throw Error('CV_FILE_CHANGED');
    const input = { job: row.jobSnapshot, rubric: row.jobSnapshot ? CV_RUBRIC : [], language: 'id' };
    const { input: _input, ...prompt } = composePrompt('cv-score', input);
    const result = await this.client.run(workId, id, 'cv-score', input, { ...prompt, model: this.config.get<string>('CV_SCORING_MODEL')?.trim() || 'gpt-6-luna' }, [{ filename, file_data: 'data:' + contentType + ';base64,' + buffer.toString('base64') }]);
    const checked = validateCvResult(result, Boolean(row.jobSnapshot));
    await this.db.$transaction(tx => saveCvAssessment(tx, row, workId, checksum, checked, CV_SCORING_VERSION));
  }
  async failure(id: string, error: string, workKey?:string, v2 = false) {
    await this.db.recruitmentCandidate.updateMany({ where: { id, ...(workKey?{revision:workKey.startsWith('CV_SCORE:'+id+':')?Number(workKey.slice(('CV_SCORE:'+id+':').length)):0}:{}), scoreStatus: { in: ['PENDING','PROCESSING'] } }, data: {
      scoreStatus: 'FAILED', cvScore: null, ...(v2 ? { cvProgress: json({ phase: 'RECOVERING', updatedAt: new Date().toISOString() }) } : {}),
      error: v2 || /UNCERTAIN|REQUIRES_REVIEW|UNCONFIRMED/.test(error) ? 'Proses AI memerlukan pemeriksaan operator. CV tetap tersimpan.' : 'Penilaian CV belum berhasil. CV tetap tersimpan dan dapat dicoba ulang.',
    } });
  }
}
