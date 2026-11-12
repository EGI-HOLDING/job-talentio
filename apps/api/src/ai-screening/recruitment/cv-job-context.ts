import { Prisma } from '@prisma/client';
import { json } from '../screening.policy';
import { queueCvProviderCleanup } from './cv-assessment-store';

export const scoreJobInclude = { jobSkills: { include: { skill: true } }, jobLanguages: { include: { language: true } } } satisfies Prisma.JobPostInclude;
export function scoringJob(job: Prisma.JobPostGetPayload<{ include: typeof scoreJobInclude }>) {
  return { title: job.title, description: job.description, experienceLevel: job.experienceLevel, experienceYearsMin: job.experienceYearsMin,
    skills: job.jobSkills.map(s => ({ name: s.skill.name, required: s.isRequired, level: s.minLevel })).sort((a,b)=>a.name.localeCompare(b.name)),
    languages: job.jobLanguages.map(l => ({ name: l.language.name, required: l.isRequired, level: l.minLevel })).sort((a,b)=>a.name.localeCompare(b.name)) };
}
export function sameScoringJob(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical).sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([x],[y])=>x.localeCompare(y)).map(([k,v])=>[k,canonical(v)]));
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// Called inside the job-edit transaction: never spend on rescoring without HR action.
// Incrementing revision also prevents a previously running assessment restoring its score.
export async function invalidateCvScores(tx: Prisma.TransactionClient, jobId: string, actorUserId: string, previous: unknown) {
  const job = await tx.jobPost.findUniqueOrThrow({where:{id:jobId},include:scoreJobInclude});
  const next = scoringJob(job);
  if (sameScoringJob(previous,next)) return 0;
  await tx.recruitmentCandidate.updateMany({where:{jobId,scoreStatus:'UPLOADING'},data:{jobSnapshot:json(next),revision:{increment:1}}});
  const rows=await tx.recruitmentCandidate.findMany({where:{jobId,scoreStatus:{notIn:['UPLOADING','DUPLICATE','ERASED']}},select:{id:true}});
  if(!rows.length)return 0;
  const ids = rows.map(row => row.id);
  await tx.recruitmentCandidate.updateMany({where:{id:{in:ids}},data:{scoreStatus:'STALE',cvScore:null,cvProgress:Prisma.DbNull,jobSnapshot:json(next),revision:{increment:1},error:'Kriteria lowongan berubah. Nilai ulang CV agar skor sesuai kriteria terbaru.'}});
  await tx.aiScreeningWork.updateMany({where:{kind:'CV_SCORE',subjectId:{in:ids},status:{in:['PENDING','FAILED']}},data:{status:'DONE',error:'JOB_CRITERIA_CHANGED',cvCheckpoint:Prisma.DbNull}});
  await queueCvProviderCleanup(tx, { subjectId: { in: ids } });
  await tx.candidateActivity.createMany({data:rows.map(row=>({candidateId:row.id,actorUserId,kind:'CV_CRITERIA_CHANGED'}))});
  return rows.length;
}
