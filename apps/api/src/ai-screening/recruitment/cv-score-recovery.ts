import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CV_PROVIDER_TASK, CV_RECOVERY_VERSION, type CvCheckpoint } from './cv-assessment';
import { json } from '../screening.policy';

export type CvOperatorAction = { action: 'RESUME' } | { action: 'CONFIRM_NOT_ACCEPTED'; reference: string };

export async function enqueueCvAssessment(tx: Pick<Prisma.TransactionClient, 'aiScreeningWork'>,
  row: { id: string; revision: number }) {
  const key = 'CV_SCORE:' + row.id + ':' + row.revision;
  await tx.aiScreeningWork.createMany({ data: { key, kind: 'CV_SCORE', subjectId: row.id, cvPolicy: CV_RECOVERY_VERSION }, skipDuplicates: true });
  return tx.aiScreeningWork.findUniqueOrThrow({ where: { key } });
}

export async function retryCvAssessmentV2(tx: Prisma.TransactionClient, row: { id: string; revision: number; scoreStatus: string },
  actorUserId: string, operation?: CvOperatorAction) {
  const work = await tx.aiScreeningWork.findUnique({ where: { key: 'CV_SCORE:' + row.id + ':' + row.revision } });
  if (work?.cvPolicy !== CV_RECOVERY_VERSION) return null;
  if (!operation) {
    if (['RUNNING', 'PENDING'].includes(work.status)) return { status: row.scoreStatus };
    return work.status === 'FAILED' && row.scoreStatus === 'FAILED' ? { status: 'RECOVERING' } : null;
  }
  if (operation.action === 'RESUME' && work.status === 'PENDING') return { status: row.scoreStatus };
  await tx.$queryRaw`SELECT id FROM "RecruitmentCandidate" WHERE id=${row.id} FOR UPDATE`;
  const current = await tx.recruitmentCandidate.findUniqueOrThrow({ where: { id: row.id }, select: { revision: true, scoreStatus: true } });
  if (current.revision !== row.revision || !['FAILED','PROCESSING','PENDING'].includes(current.scoreStatus)) throw new ConflictException('Penilaian CV sudah berubah.');
  if (!(await tx.aiScreeningWork.updateMany({ where: { id: work.id, status: work.status === 'FAILED' ? 'FAILED' : 'PENDING' },
    data: { status: 'PENDING', availableAt: new Date(), attempts: 0, error: null, leaseUntil: null, leaseOwner: null } })).count)
    throw new ConflictException('Penilaian sedang berjalan.');
  const latest = await tx.aiScreeningCall.findFirst({ where: { workId: work.id, task: CV_PROVIDER_TASK },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const unconfirmed = latest && ['SENDING','UNCERTAIN'].includes(latest.status) && !latest.responseId;
  if (operation.action === 'CONFIRM_NOT_ACCEPTED') {
    if (!unconfirmed || !(await tx.aiScreeningCall.updateMany({ where: { id: latest.id, status: 'UNCERTAIN', responseId: null },
      data: { status: 'FAILED', error: 'PROVIDER_CONFIRMED_NOT_ACCEPTED' } })).count) throw new ConflictException('Status permintaan provider sudah berubah.');
  } else if (unconfirmed) {
    throw new ConflictException('Permintaan provider sedang direkonsiliasi.');
  }
  const checkpoint = work.cvCheckpoint as CvCheckpoint | null;
  if (checkpoint && (work.status === 'FAILED' || operation.action === 'CONFIRM_NOT_ACCEPTED')) {
    const sent = await tx.aiScreeningCall.count({ where: { workId: work.id, task: CV_PROVIDER_TASK } });
    await tx.aiScreeningWork.update({ where: { id: work.id }, data: { cvCheckpoint: json({ ...checkpoint, cycleFrom: sent, alertAt: undefined,
      ...(operation.action === 'CONFIRM_NOT_ACCEPTED' ? { consumed: latest?.id } : {}) }) } });
  }
  await tx.recruitmentCandidate.update({ where: { id: row.id }, data: { scoreStatus: 'PENDING', error: null,
    cvProgress: json({ phase: 'REPAIRING', updatedAt: new Date().toISOString() }) } });
  await tx.candidateActivity.create({ data: { candidateId: row.id, actorUserId, kind: 'CV_RETRY',
    detail: json({ recovery: operation.action, ...(operation.action === 'CONFIRM_NOT_ACCEPTED' ? { reference: operation.reference } : {}) }) } });
  return { status: 'PENDING' };
}

// A retired request with an unknown outcome must be reconciled before any new submission.
export async function assertNoUnresolvedCvSubmission(tx: Prisma.TransactionClient, id: string) {
  if (await tx.aiScreeningCall.count({ where: { subjectId: id, OR: [
    { status: { in: ['SENDING', 'UNCERTAIN'] } },
    { status: 'RUNNING', OR: [{ task: { not: CV_PROVIDER_TASK } }, { responseId: null }] },
  ] } }))
    throw new ConflictException('Proses AI memerlukan pemeriksaan operator sebelum dicoba ulang.');
}
