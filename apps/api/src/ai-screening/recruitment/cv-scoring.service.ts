import { scoringJob, scoreJobInclude, sameScoringJob } from './cv-job-context';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ScreeningClient } from '../screening.client';
import { composePrompt } from '../prompts/compose';
import { json } from '../screening.policy';
import { CV_MAX_BYTES, CV_RUBRIC, CV_SCORING_VERSION, fileChecksum, validateCvBytes, validateCvResult } from './cv-scoring.policy';

@Injectable()
export class CvScoringService {
  constructor(private db: PrismaService, private storage: StorageService, private client: ScreeningClient, private config: ConfigService) {}
  async process(workId: string, id: string) {
    const row = await this.db.recruitmentCandidate.findUnique({ where: { id } });
    if (!row || !row.fileKey || !['PENDING','PROCESSING'].includes(row.scoreStatus)) return;
    const work=await this.db.aiScreeningWork.findUnique({where:{id:workId},select:{key:true}});
    const expected=work?.key.startsWith('CV_SCORE:'+id+':')?Number(work.key.slice(('CV_SCORE:'+id+':').length)):0;
    if(work&&expected!==row.revision)return;
    if(row.jobId){const job=await this.db.jobPost.findUniqueOrThrow({where:{id:row.jobId},include:scoreJobInclude});
      if(!sameScoringJob(row.jobSnapshot,scoringJob(job))){await this.db.recruitmentCandidate.updateMany({where:{id,revision:row.revision},data:{scoreStatus:'STALE',cvScore:null,revision:{increment:1},error:'Kriteria lowongan berubah. Nilai ulang CV dengan kriteria terbaru.'}});return;}}
    const company = await this.db.company.findUnique({ where: { id: row.companyId }, select: { anonymizedAt: true, isBanned: true } });
    if (!company || company.anonymizedAt || company.isBanned) throw Error('COMPANY_UNAVAILABLE');
    const claim=await this.db.recruitmentCandidate.updateMany({where:{id,revision:row.revision,scoreStatus:{in:['PENDING','PROCESSING']}},data:{scoreStatus:'PROCESSING',error:null}});
    if(!claim.count)return;
    const buffer = await this.storage.getObjectBuffer(row.fileKey, CV_MAX_BYTES);
    const extension = row.fileKey.split('.').at(-1)?.toLowerCase();
    const filename = /\.(pdf|docx?)$/i.test(row.filename) ? row.filename : row.filename + '.' + (['pdf','doc','docx'].includes(extension ?? '') ? extension : 'pdf');
    const contentType = validateCvBytes(buffer, filename), checksum = fileChecksum(buffer);
    if (row.checksum && row.checksum !== checksum) throw Error('CV_FILE_CHANGED');
    const input = { job: row.jobSnapshot, rubric: row.jobSnapshot ? CV_RUBRIC : [], language: 'id' };
    const { input: _input, ...prompt } = composePrompt('cv-score', input);
    const result = await this.client.run(workId, id, 'cv-score', input, { ...prompt, model: this.config.get<string>('CV_SCORING_MODEL')?.trim() || 'gpt-6-luna' }, [{ filename, file_data: 'data:' + contentType + ';base64,' + buffer.toString('base64') }]);
    const checked = validateCvResult(result, Boolean(row.jobSnapshot));
    await this.db.$transaction(async tx => {
      const saved = await tx.recruitmentCandidate.updateMany({ where: { id, revision: row.revision, fileKey: row.fileKey, scoreStatus:'PROCESSING' }, data: {
        scoreStatus: checked.result.readable ? row.jobSnapshot ? 'READY' : 'EXTRACTED' : 'UNREADABLE', cvScore: checked.score,
        cvResult: json(checked.result), checksum, scoringVersion: CV_SCORING_VERSION, error: checked.result.readable ? null : 'CV belum dapat dibaca. Periksa berkas atau upload ulang.',
        ...(row.applicationId ? {} : { fullName: checked.result.fullName ?? row.fullName, email: checked.result.email?.toLowerCase(), phone: checked.result.phone }), headline: checked.result.headline,
      } });
      if (saved.count) await tx.candidateActivity.create({ data: { candidateId: id, kind: checked.result.readable ? 'CV_ANALYZED' : 'CV_UNREADABLE', detail: json({ score: checked.score, methodology: CV_SCORING_VERSION }) } });
      if (saved.count && row.applicationId && checked.result.readable) {
        const application = await tx.application.findUnique({ where: { id: row.applicationId }, select: { resumeVersionId: true } });
        if (application?.resumeVersionId) {
          const versionId = application.resumeVersionId;
          await tx.aiCvSource.upsert({ where: { versionId }, create: { versionId, checksum, status: 'READY', text: checked.result.cvText }, update: {} });
          await tx.aiCvSource.updateMany({ where: { versionId, status: { not: 'READY' } }, data: { checksum, status: 'READY', text: checked.result.cvText, error: null } });
        }
      }
    });
  }
  async failure(id: string, error: string, workKey?:string) {
    await this.db.recruitmentCandidate.updateMany({ where: { id, ...(workKey?{revision:workKey.startsWith('CV_SCORE:'+id+':')?Number(workKey.slice(('CV_SCORE:'+id+':').length)):0}:{}), scoreStatus: { in: ['PENDING','PROCESSING'] } }, data: {
      scoreStatus: 'FAILED', cvScore: null, error: /UNCERTAIN|REQUIRES_REVIEW|UNCONFIRMED/.test(error) ? 'Proses AI memerlukan pemeriksaan operator. CV tetap tersimpan.' : 'Penilaian CV belum berhasil. CV tetap tersimpan dan dapat dicoba ulang.',
    } });
  }
}
