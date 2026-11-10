import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// Resume the exact revision and provider response. Never authorize another billed creation.
export async function resumeKnownCvScore(tx: Prisma.TransactionClient, row: { id: string; revision: number; scoreStatus: string }, actorUserId: string) {
  const statuses = row.scoreStatus === 'FAILED' ? ['RUNNING', 'UNCERTAIN'] : ['UNCERTAIN'];
  const unresolved = await tx.aiScreeningCall.findMany({ where: { subjectId: row.id, status: { in: statuses } }, select: { workId: true, responseId: true } });
  if (!unresolved.length) return false;
  const work = await tx.aiScreeningWork.findUnique({ where: { key: 'CV_SCORE:' + row.id + ':' + row.revision } });
  if (row.scoreStatus !== 'FAILED' || !work || work.kind !== 'CV_SCORE' || work.subjectId !== row.id || work.status !== 'FAILED' ||
      unresolved.some(call => call.workId !== work.id || !call.responseId || !/^resp_[a-zA-Z0-9_-]+$/.test(call.responseId))) {
    throw new ConflictException('Proses AI memerlukan pemeriksaan operator sebelum dicoba ulang.');
  }
  const claimed = await tx.recruitmentCandidate.updateMany({ where: { id: row.id, revision: row.revision, scoreStatus: 'FAILED' }, data: { scoreStatus: 'PENDING', error: null } });
  if (!claimed.count) throw new ConflictException('Proses ulang sudah dimulai.');
  const resumed = await tx.aiScreeningWork.updateMany({ where: { id: work.id, status: 'FAILED' }, data: { status: 'PENDING', availableAt: new Date(), leaseUntil: null, leaseOwner: null, error: null } });
  if (!resumed.count) throw new ConflictException('Proses ulang sudah dimulai.');
  await tx.candidateActivity.create({ data: { candidateId: row.id, actorUserId, kind: 'CV_RETRY', detail: { recovery: 'RESUME_EXISTING_RESPONSE' } } });
  return true;
}
