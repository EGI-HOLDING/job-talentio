import type { Prisma } from '@prisma/client';
import type { AssessmentLanguage } from '@job-talentio/shared';
import { isAssessmentLanguageReminder } from '../assessment-language';
import { enqueueEvaluationPdf, enqueueWork } from '../screening-packets.service';
import { json } from '../screening.policy';
import type { RoleJudgement, RoleTranscriptEntry } from '../taka-role-assessment';
import { roleLiveTranscript } from '../taka-role-assessment';
import { heardContinuousTurn, roleAssessmentVoiceEvidence, roleVoiceTurns, playbackOrigin } from './voice-role';
import type { Fragment } from './voice.policy';
import type { NativeProgress } from './voice-native';
import { VOICE_HARD_MS } from './voice.policy';

export const LIVE_COMPLETION_VERSION = 'tara-live-completion-v1';
export const LIVE_DEEPEN_MS = 12 * 60_000;
export const LIVE_EVALUATION_WORK = 'VOICE_EVALUATE';
export const LIVE_RESUME_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const LIVE_INITIALIZATION_MS = 15_000;
export const LIVE_CLOSE_RESERVE_MS = 1000;
export const LIVE_RESUME_MINIMUM_MS = LIVE_INITIALIZATION_MS + LIVE_CLOSE_RESERVE_MS;

export type LiveCompletion = {
    version: typeof LIVE_COMPLETION_VERSION;
    status: 'IN_PROGRESS' | 'ASSESSING' | 'RESUMABLE' | 'REVIEW_REQUIRED' | 'INTERRUPTED' | 'COMPLETE';
    evidenceRevision: number;
    assessedEvidenceRevision?: number;
    evaluationRepair?: number;
    missingCriterionIds: string[];
    activeConnectionId?: string;
    usedVoiceMs?: number;
    remainingVoiceMs?: number;
    retained?: Array<[string, RoleJudgement]>;
    resumeExpiresAt?: string;
    closedBy?: 'TARA_FINISHED' | 'CANDIDATE_ENDED' | 'TIME_LIMIT';
    canRetry?: boolean;
    reason?: 'COVERAGE' | 'TIME_LIMIT' | 'CONNECTION_LOST' | 'CONNECTION_UNCONFIRMED' | 'CANDIDATE_PAUSED' | 'ASSESSMENT' | 'CV';
};
export const newLiveCompletion = (): LiveCompletion => ({
    version: LIVE_COMPLETION_VERSION, status: 'IN_PROGRESS', evidenceRevision: 0, missingCriterionIds: [],
});
export function liveCompletion(value: unknown) {
    const record = value as LiveCompletion | null;
    return record?.version === LIVE_COMPLETION_VERSION ? record : undefined;
}
export function canPublishLiveReport(completion?: LiveCompletion) {
    return !completion || ['COMPLETE', 'INTERRUPTED', 'REVIEW_REQUIRED'].includes(completion.status);
}
export function usesLiveCompletion(snapshot: unknown) {
    return (snapshot as { liveCompletionVersion?: string } | null)?.liveCompletionVersion === LIVE_COMPLETION_VERSION;
}
export function liveEvaluationKey(id: string, evidenceRevision: number, repair = 0) {
    return LIVE_EVALUATION_WORK + ':' + id + ':evidence:' + evidenceRevision + (repair ? ':repair:' + repair : '');
}

export async function markLiveEvaluationUnrecoverable(db: {
    $transaction: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
}, sessionId: string, workKey: string | undefined, workId: string, error: string) {
    if (!workKey?.startsWith(LIVE_EVALUATION_WORK + ':' + sessionId + ':evidence:')) return false;
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${sessionId} FOR UPDATE`;
        const current = await tx.aiScreeningSession.findUnique({ where: { id: sessionId } });
        const completion = liveCompletion(current?.voiceCompletion);
        if (completion?.status === 'ASSESSING' && workKey === liveEvaluationKey(sessionId, completion.evidenceRevision, completion.evaluationRepair)) {
            const unconfirmed = await tx.aiScreeningCall.count({ where: { workId, status: { in: ['RUNNING', 'UNCERTAIN'] }, responseId: null } });
            await tx.aiScreeningSession.update({ where: { id: sessionId }, data: {
                voiceCompletion: json({ ...completion, status: 'REVIEW_REQUIRED', reason: 'ASSESSMENT', canRetry: !unconfirmed }),
                revision: { increment: 1 },
            } });
            await tx.aiScreeningEvaluation.updateMany({ where: { sessionId }, data: { status: 'NEEDS_REVIEW', error } });
        }
        return true;
    });
}
export function canResumeLive(completion: LiveCompletion, deadline: Date | null, now = Date.now()) {
    if (completion.remainingVoiceMs !== undefined) return completion.status === 'RESUMABLE' &&
        completion.remainingVoiceMs >= LIVE_RESUME_MINIMUM_MS && Boolean(completion.resumeExpiresAt && Date.parse(completion.resumeExpiresAt) > now);
    return completion.status === 'RESUMABLE' && (deadline === null ? !completion.resumeExpiresAt ||
        Date.parse(completion.resumeExpiresAt) > now : +deadline > now);
}

export function reportedVoiceMs(usage: unknown) {
    const seconds = (usage as { seconds?: unknown } | null)?.seconds;
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : undefined;
}

type Connection = {
    id: string; createdAt: Date; endedAt?: Date | null; taraInterview: unknown; transcriptComplete: boolean; closeReason: string | null;
    fragments: Fragment[];
};

function connectionTimeline(connections: readonly Connection[]) {
    let end = 0;
    return connections.map((connection, index) => {
        // Each provider connection starts its own clock. Preserve the original
        // fragment IDs, and join the presentation timeline only after grouping.
        const offset = index === 0 ? 0 : end + 1;
        end = offset + connection.fragments.reduce((last, row) => Math.max(last, row.endMs), 0);
        return { connection, offset };
    });
}

export function liveTranscript(connections: readonly Connection[]) {
    return connectionTimeline(connections).flatMap(({ connection, offset }) => roleVoiceTurns(connection.fragments, true).map(turn => ({
        ...turn, startMs: turn.startMs + offset, endMs: turn.endMs + offset,
    })));
}

export function liveResumeHistory(connections: readonly Connection[]) {
    const turns = liveAssessmentTranscript(connections);
    const lastResponse = new Map<string | undefined, number>();
    for (const [index, turn] of turns.entries()) {
        if (turn.speaker === 'CANDIDATE' && turn.text.trim()) lastResponse.set(turn.connectionId, index);
    }
    return turns.flatMap((turn, index) => {
        const interrupted = turn.playback === 'INTERRUPTED';
        const playbackUnverified = turn.playback === 'UNKNOWN' || turn.playback === 'HEALTHY_UNVERIFIED';
        // Treat only the delivered part of the unanswered tail as shared history.
        if ((interrupted || playbackUnverified) && index > (lastResponse.get(turn.connectionId) ?? -1)) return [];
        const text = turn.text.trim();
        return text ? [{ speaker: turn.speaker, text,
            ...(interrupted ? { interrupted: true } : {}),
            ...(playbackUnverified ? { playbackUnverified: true } : {}),
            ...(turn.cutShort ? { cutShort: true } : {}),
        }] : [];
    });
}

export function liveLanguageReminderDelivered(connections: readonly Connection[], language: AssessmentLanguage) {
    return connections.some(connection => {
        const delivery = (connection.taraInterview as NativeProgress | null)?.nativeDelivery;
        if (!delivery?.playbackVerified || delivery.firstAudioMs === undefined) return false;
        const turns = roleVoiceTurns(connection.fragments, true);
        const origin = playbackOrigin(turns, delivery);
        if (origin === undefined) return false;
        return turns.some(turn => turn.speaker === 'TARA' && isAssessmentLanguageReminder(turn.text, language) &&
            heardContinuousTurn(turn, delivery, origin));
    });
}

export function liveAssessmentTranscript(connections: readonly Connection[]): RoleTranscriptEntry[] {
    return connectionTimeline(connections).flatMap(({ connection, offset }) => {
        const delivery = (connection.taraInterview as NativeProgress | null)?.nativeDelivery ?? { sequence: 0, windows: [] };
        const turns = roleAssessmentVoiceEvidence(connection.fragments, delivery, true);
        const origin = playbackOrigin(turns, delivery);
        const assessment = roleLiveTranscript(turns, !connection.transcriptComplete || connection.closeReason === 'TIME_LIMIT', true, {
            playbackHealthy: origin !== undefined && (delivery.playbackVerified === true ||
                delivery.playbackReadyAt !== undefined && delivery.windows.some(window => !window.interrupted)),
            playWindowNear: turn => origin !== undefined && delivery.windows.some(window => !window.interrupted &&
                window.start <= origin + turn.endMs && window.end >= origin + turn.startMs),
            connectionId: connection.id,
            cutShortAfterMs: origin !== undefined && connection.endedAt ? +connection.endedAt - origin - 350 : undefined,
        });
        return assessment.map(turn => ({ ...turn, startMs: turn.startMs + offset, endMs: turn.endMs + offset }));
    });
}

export function liveCompletionDecision(completion: LiveCompletion, options: {
    finalScore: number | null; cvMissing: boolean; deadline: Date | null; replacementUsed: boolean;
    interrupted: boolean; assessmentFailed: boolean; missingCriterionIds: string[]; now: number; cannotResume?: boolean;
}): LiveCompletion {
    // An evaluation retry must use the original continuation window, including when it is already expired.
    const next = { ...completion, missingCriterionIds: options.missingCriterionIds, reason: undefined, canRetry: undefined };
    if (options.finalScore !== null) return { ...next, status: 'COMPLETE' };
    if (completion.remainingVoiceMs !== undefined) {
        const resumeExpiresAt = completion.resumeExpiresAt ?? new Date(options.now + LIVE_RESUME_WINDOW_MS).toISOString();
        if ((options.interrupted || completion.closedBy === 'TARA_FINISHED' || completion.closedBy === 'CANDIDATE_ENDED') &&
            options.missingCriterionIds.length &&
            completion.remainingVoiceMs >= LIVE_RESUME_MINIMUM_MS &&
            Date.parse(resumeExpiresAt) > options.now && !options.cannotResume)
            return { ...next, status: 'RESUMABLE', resumeExpiresAt, reason: completion.reason === 'CANDIDATE_PAUSED'
                ? 'CANDIDATE_PAUSED' : options.interrupted ? 'CONNECTION_LOST' : 'COVERAGE' };
        if (options.cvMissing || options.assessmentFailed || options.cannotResume)
            return { ...next, status: 'REVIEW_REQUIRED', reason: options.cvMissing ? 'CV' : options.cannotResume ? 'CONNECTION_UNCONFIRMED' : 'ASSESSMENT' };
        return { ...next, status: 'INTERRUPTED', reason: completion.remainingVoiceMs < LIVE_RESUME_MINIMUM_MS ? 'TIME_LIMIT' : 'COVERAGE' };
    }
    if (options.cvMissing || options.assessmentFailed)
        return { ...next, status: 'REVIEW_REQUIRED', reason: options.cvMissing ? 'CV' : 'ASSESSMENT' };
    const expired = options.deadline !== null && +options.deadline <= options.now;
    if (options.missingCriterionIds.length && !options.replacementUsed && !expired)
        return { ...next, status: 'RESUMABLE', reason: options.interrupted ? 'CONNECTION_LOST' : 'COVERAGE',
            ...(options.deadline === null ? { resumeExpiresAt: new Date(options.now + 20 * 60_000).toISOString() } : {}) };
    return { ...next, status: 'INTERRUPTED', reason: expired ? 'TIME_LIMIT' : options.interrupted ? 'CONNECTION_LOST' : 'COVERAGE' };
}

export function voiceBudgetAfterClose(used: number, billed: number) {
    const usedVoiceMs = used + Math.max(LIVE_INITIALIZATION_MS, billed);
    return { usedVoiceMs, remainingVoiceMs: Math.max(0, VOICE_HARD_MS - usedVoiceMs) };
}

export async function reconcileLiveEvaluations(db: {
    $transaction: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
    $queryRaw: Prisma.TransactionClient['$queryRaw'];
}, now: Date) {
    const stranded = await db.$queryRaw<Array<{ id: string }>>`
        SELECT s.id FROM "AiScreeningSession" s
        LEFT JOIN "AiScreeningWork" w ON w.key = 'VOICE_EVALUATE:' || s.id || ':evidence:' || (s."voiceCompletion"->>'evidenceRevision') ||
          CASE WHEN COALESCE(s."voiceCompletion"->>'evaluationRepair', '0') = '0' THEN ''
               ELSE ':repair:' || (s."voiceCompletion"->>'evaluationRepair') END
        WHERE s.status = 'ACTIVE' AND s."voiceCompletion"->>'status' = 'ASSESSING'
          AND s."updatedAt" < ${new Date(+now - 30_000)} AND (w.id IS NULL OR w.status IN ('DONE', 'FAILED'))
        ORDER BY s."updatedAt" LIMIT 25`;
    for (const { id } of stranded) await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${id} FOR UPDATE`;
        const row = await tx.aiScreeningSession.findUnique({ where: { id }, select: { status: true, voiceCompletion: true } });
        const completion = liveCompletion(row?.voiceCompletion);
        if (row?.status !== 'ACTIVE' || completion?.status !== 'ASSESSING') return;
        const key = liveEvaluationKey(id, completion.evidenceRevision, completion.evaluationRepair);
        const work = await enqueueWork(tx, LIVE_EVALUATION_WORK, id, key);
        if (work.status === 'FAILED') {
            const unconfirmed = await tx.aiScreeningCall.count({ where: { workId: work.id, status: { in: ['RUNNING', 'UNCERTAIN'] }, responseId: null } });
            await tx.aiScreeningSession.update({ where: { id }, data: { voiceCompletion: json({ ...completion,
                status: 'REVIEW_REQUIRED', reason: 'ASSESSMENT', canRetry: !unconfirmed }), revision: { increment: 1 } } });
            await tx.aiScreeningEvaluation.updateMany({ where: { sessionId: id }, data: { status: 'NEEDS_REVIEW' } });
        } else if (work.status === 'DONE') {
            await tx.aiScreeningWork.updateMany({ where: { id: work.id, status: 'DONE' }, data: { status: 'PENDING', availableAt: now } });
        }
    });
}

export async function expireLiveContinuations(db: {
    aiScreeningSession: Pick<Prisma.TransactionClient['aiScreeningSession'], 'findMany'>;
    $transaction: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
}, now: Date) {
    const expired = await db.aiScreeningSession.findMany({
        where: { status: 'ACTIVE', voiceCompletion: { path: ['status'], equals: 'RESUMABLE' }, OR: [
            { voiceDeadlineAt: { lte: now } },
            { voiceDeadlineAt: null, voiceCompletion: { path: ['resumeExpiresAt'], lte: now.toISOString() } },
        ] },
        orderBy: { voiceDeadlineAt: 'asc' },
        select: { id: true, invitation: { select: { id: true } } }, take: 25,
    });
    for (const session of expired) {
        if (!session.invitation) continue;
        const invitationId = session.invitation.id;
        await db.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "ScreeningInvitation" WHERE id=${invitationId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${session.id} FOR UPDATE`;
            const current = await tx.aiScreeningSession.findUnique({ where: { id: session.id },
                include: { invitation: true, evaluation: { select: { inputHash: true } } } });
            const completion = liveCompletion(current?.voiceCompletion);
            if (current?.invitation?.status !== 'STARTED' || !completion || completion.status !== 'RESUMABLE' ||
                canResumeLive(completion, current.voiceDeadlineAt, +now)) return;
            if (completion.remainingVoiceMs !== undefined && completion.assessedEvidenceRevision !== completion.evidenceRevision &&
                (!current.evaluation?.inputHash || completion.reason === 'CANDIDATE_PAUSED' || completion.reason === 'CONNECTION_LOST')) {
                await tx.aiScreeningSession.update({ where: { id: session.id }, data: { voiceCompletion: json({ ...completion,
                    status: 'ASSESSING', remainingVoiceMs: 0 }), revision: { increment: 1 } } });
                await enqueueWork(tx, LIVE_EVALUATION_WORK, session.id, liveEvaluationKey(session.id, completion.evidenceRevision));
                return;
            }
            await tx.aiScreeningSession.update({ where: { id: session.id }, data: {
                status: 'INTERRUPTED', completedAt: current.voiceDeadlineAt ?? now, revision: { increment: 1 },
                voiceCompletion: json({ ...completion, status: 'INTERRUPTED', reason: 'TIME_LIMIT', retained: undefined }),
            } });
            await tx.screeningInvitation.update({ where: { id: invitationId }, data: { status: 'INTERRUPTED' } });
            if (current.evaluation?.inputHash) await enqueueEvaluationPdf(tx, session.id, current.evaluation.inputHash);
        });
    }
}
