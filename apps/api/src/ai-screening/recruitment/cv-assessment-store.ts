import type { Prisma, RecruitmentCandidate } from '@prisma/client';
import { json } from '../screening.policy';
import { CV_PROVIDER_TASK, type CvProgress } from './cv-assessment';
import type { validateCvResult } from './cv-scoring.policy';

export function queueCvProviderWork(tx: Pick<Prisma.TransactionClient, 'aiScreeningWork'>,
  kind: 'CV_PROVIDER_DELETE' | 'CV_PROVIDER_EVENT', responseId: string, eventId = responseId) {
  return tx.aiScreeningWork.createMany({ data: { key: kind + ':' + eventId, kind, subjectId: responseId }, skipDuplicates: true });
}

export async function queueCvProviderCleanup(tx: Prisma.TransactionClient, where: Prisma.AiScreeningCallWhereInput) {
  const calls = await tx.aiScreeningCall.findMany({ where: { ...where, task: CV_PROVIDER_TASK, responseId: { not: null },
    status: { in: ['RUNNING', 'UNCERTAIN'] } }, select: { responseId: true } });
  if (calls.length) await tx.aiScreeningWork.createMany({ data: calls.map(({ responseId }) =>
    ({ key: 'CV_PROVIDER_DELETE:' + responseId, kind: 'CV_PROVIDER_DELETE', subjectId: responseId! })), skipDuplicates: true });
}

export async function saveCvAssessment(tx: Prisma.TransactionClient, row: RecruitmentCandidate, workId: string,
  checksum: string, checked: ReturnType<typeof validateCvResult>, version: string,
  publication?: { phase: CvProgress['phase']; sourceReferences: object; roleAssessment?: object }) {
  const received = await tx.candidateActivity.findFirst({ where: { candidateId: row.id, kind: 'CV_RECEIVED' },
    orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  const receivedAt = received?.createdAt ?? (row.applicationId ? row.createdAt : null);
  const completedAt = new Date();
  const timing = { receivedAt: receivedAt?.toISOString() ?? null, completedAt: completedAt.toISOString(),
    elapsedMs: receivedAt ? +completedAt - +receivedAt : null, revision: row.revision, workId };
  const { result, score } = checked;
  const saved = await tx.recruitmentCandidate.updateMany({
    where: { id: row.id, revision: row.revision, fileKey: row.fileKey, scoreStatus: 'PROCESSING' },
    data: {
      scoreStatus: result.readable ? row.jobSnapshot ? 'READY' : 'EXTRACTED' : 'UNREADABLE',
      cvScore: score, cvResult: json(publication ? { ...result, sourceReferences: publication.sourceReferences,
        roleAssessment: publication.roleAssessment } : result), checksum, scoringVersion: version,
      ...(publication ? { cvProgress: json({ phase: publication.phase, updatedAt: completedAt.toISOString() }) } : {}),
      error: result.readable ? null : 'CV belum dapat dibaca. Periksa berkas atau upload ulang.',
      ...(row.applicationId ? {} : { fullName: result.fullName ?? row.fullName, email: result.email?.toLowerCase(), phone: result.phone }),
      headline: result.headline,
    },
  });
  if (!saved.count) return;
  await tx.candidateActivity.create({ data: { candidateId: row.id, kind: result.readable ? 'CV_ANALYZED' : 'CV_UNREADABLE',
    detail: json({ score, methodology: version, timing }) } });
  if (!row.applicationId || !result.readable) return;
  const application = await tx.application.findUnique({ where: { id: row.applicationId }, select: { resumeVersionId: true } });
  if (!application?.resumeVersionId) return;
  const versionId = application.resumeVersionId;
  await tx.aiCvSource.upsert({ where: { versionId }, create: { versionId, checksum, status: 'READY', text: result.cvText }, update: {} });
  await tx.aiCvSource.updateMany({ where: { versionId, status: { not: 'READY' } },
    data: { checksum, status: 'READY', text: result.cvText, error: null } });
}
