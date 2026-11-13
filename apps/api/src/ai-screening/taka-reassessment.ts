import type { Prisma } from '@prisma/client';
import { TARA_LIVE_AUDIO_PROTOCOL } from '@job-talentio/shared';
import { frozenRoleRubric, ROLE_ASSESSMENT_VERSION } from './role-rubric';
import { enqueueWork } from './screening-packets.service';
import { hash } from './screening.policy';
import { TAKA_ROLE_EVIDENCE_VERSION, TAKA_ROLE_VALIDATION_VERSION } from './taka-versions';

export const TAKA_REASSESS_KIND = 'VOICE_REASSESS';
export const takaVoiceInput = {
    fragments: { orderBy: { id: 'asc' } },
    session: { include: { currentPlan: true, invitation: true, package: true, evaluation: true } },
} satisfies Prisma.VoiceInterviewInclude;
type SavedVoice = Prisma.VoiceInterviewGetPayload<{ include: typeof takaVoiceInput }>;
type ReplayDb = Pick<Prisma.TransactionClient, 'voiceInterview' | 'aiScreeningCall' | 'aiScreeningWork' | '$queryRaw'>;

export function takaReassessment(voice: SavedVoice | null) {
    const session = voice?.session, evaluation = session?.evaluation, packet = session?.package;
    const role = frozenRoleRubric(packet?.jobSnapshot);
    const report = (evaluation?.result as { roleAssessment?: { version?: string; coverage?: { assessed?: number } } } | null)?.roleAssessment;
    const savedResponseOnly = evaluation?.promptVersion === TAKA_ROLE_EVIDENCE_VERSION &&
        report?.version === TAKA_ROLE_EVIDENCE_VERSION && report?.coverage?.assessed === 0;
    if (!voice || !session || !evaluation?.result || !evaluation.inputHash || !packet || !role || !session.currentPlan ||
        voice.promptVersion !== TARA_LIVE_AUDIO_PROTOCOL || voice.status !== 'ENDED' || !voice.endedAt ||
        voice.closeReason === 'ACCOUNT_ERASED' || !voice.fragments.some(part => part.speaker === 'CANDIDATE') ||
        session.status !== 'COMPLETED' || session.invitation?.status !== 'COMPLETED' ||
        evaluation.status !== 'NEEDS_REVIEW' || evaluation.promptVersion !== ROLE_ASSESSMENT_VERSION && !savedResponseOnly) return null;
    const evidenceRevision = hash([voice.id, voice.endedAt, voice.closeReason, voice.transcriptComplete, voice.taraInterview,
        voice.fragments.map(({ id, speaker, startMs, endMs, text }) => [id, speaker, startMs, endMs, text]),
        session.revision, session.currentPlan, session.invitation.snapshot, packet.fingerprint, packet.payload, role.revision]);
    return { key: [TAKA_REASSESS_KIND, session.id, TAKA_ROLE_VALIDATION_VERSION, evidenceRevision, evaluation.inputHash].join(':'),
        evidenceRevision, previous: evaluation.inputHash, rubricRevision: role.revision, savedResponseOnly };
}

export async function savedTakaResponses(db: ReplayDb, sessionId: string, evaluationHash: string) {
    // Only use the responses from the work that published the current revision.
    // Old evaluation work or a different revision can never supply the quotes.
    const work = await db.aiScreeningWork.findFirst({ where: { subjectId: sessionId, kind: TAKA_REASSESS_KIND,
        status: 'DONE', key: { startsWith: [TAKA_REASSESS_KIND, sessionId, TAKA_ROLE_EVIDENCE_VERSION].join(':') + ':' } },
        orderBy: { createdAt: 'desc' }, select: { id: true, key: true } });
    const from = work?.key.split(':').at(-1);
    if (!work || !from) return null;
    const calls = await db.aiScreeningCall.findMany({ where: { workId: work.id, subjectId: sessionId, task: 'evaluate',
        promptVersion: TAKA_ROLE_EVIDENCE_VERSION, status: 'COMPLETED' }, select: { key: true, inputHash: true, result: true } });
    return calls.length ? { calls, from, evaluationHash } : null;
}

export async function inspectTakaReassessment(db: ReplayDb, sessionId: string) {
    const voice = await db.voiceInterview.findUnique({ where: { sessionId }, include: takaVoiceInput });
    const revision = takaReassessment(voice);
    if (!revision || !voice) return null;
    if (revision.savedResponseOnly) {
        const saved = await savedTakaResponses(db, sessionId, revision.previous);
        return saved ? { ...revision, sessionId, badReferences: 0, storedEvidence: null, fragments: voice.fragments.length, savedResponses: saved.calls.length } : null;
    }
    const calls = await db.aiScreeningCall.findMany({ where: { subjectId: sessionId, task: 'evaluate', promptVersion: ROLE_ASSESSMENT_VERSION },
        select: { status: true, result: true } });
    if (calls.some(row => ['RUNNING', 'UNCERTAIN'].includes(row.status))) return null;
    const badReferences = new Set<string>();
    const storedEvidence = new Set<string>();
    const fragments = new Set(voice.fragments.filter(row => row.speaker === 'CANDIDATE').map(row => row.id));
    for (const call of calls) {
        if (call.status !== 'COMPLETED') continue;
        const rows = (call.result as { criteria?: Record<string, { questionRef?: string; level?: number; evidence?: string[] }> } | null)?.criteria;
        for (const [id, row] of Object.entries(rows ?? {})) {
            if (row?.questionRef !== id || typeof row.level !== 'number') continue;
            badReferences.add(id);
            for (const reference of Array.isArray(row.evidence) ? row.evidence : []) {
                const match = /^answer:v(\d+):\d+$/u.exec(reference);
                if (match && fragments.has(Number(match[1]))) storedEvidence.add(reference);
            }
        }
    }
    return { ...revision, sessionId, badReferences: badReferences.size, storedEvidence: storedEvidence.size, fragments: voice.fragments.length };
}

export async function queueTakaReassessment(tx: ReplayDb, sessionId: string, expected: string) {
    const invitation = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ScreeningInvitation" WHERE "sessionId"=${sessionId} FOR UPDATE`;
    if (!invitation.length) return null;
    await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${sessionId} FOR UPDATE`;
    const existing = await tx.aiScreeningWork.findUnique({ where: { key: expected } });
    if (existing?.kind === TAKA_REASSESS_KIND && existing.subjectId === sessionId) return existing;
    const current = await inspectTakaReassessment(tx, sessionId);
    if (!current || current.key !== expected || !current.badReferences && !current.savedResponseOnly) return null;
    return enqueueWork(tx, TAKA_REASSESS_KIND, sessionId, current.key);
}
