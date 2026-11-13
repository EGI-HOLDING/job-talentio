import type { PrismaService } from '../prisma/prisma.service';
import type { CandidatePayload, PackagePayload } from './screening.schemas';
import type { PromptPreset } from './prompts/compose';
import { AiPending, AiUncertain, type ScreeningClient } from './screening.client';
import { enqueueEvaluationPdf } from './screening-packets.service';
import { combineScores, hash, json } from './screening.policy';
import { acceptTakaJudgements, prepareTakaEvidence, scoreTakaInterview, takaEvaluationRequest } from './taka-interview';
import type { taraInterviewReport } from './tara-interview';
import { invalidateHrRanking } from '../matching/recruiter-ranking.service';
import type { RoleRubric } from './role-rubric';
import { acceptRoleJudgements, frozenRoleAssessment, prepareRoleEvidence, roleEvaluationRequest,
    scoreRoleAssessment, type RoleTranscriptEntry } from './taka-role-assessment';

export async function evaluateTakaInterview(
    db: PrismaService, client: ScreeningClient, workId: string,
    session: { id: string; revision: number; currentPlanId: string | null; applicationId: string | null },
    invitation: { id: string; snapshot: unknown } | null,
    preset: PromptPreset, plan: CandidatePayload, turns: Parameters<typeof prepareTakaEvidence>[1],
    { interrupted, notes, owner, voice, rubric, applicationCv, role }: { interrupted: boolean; notes?: ReturnType<typeof taraInterviewReport>; owner?: string;
        rubric: PackagePayload;
        applicationCv?: { assessable: boolean; total: number } | null;
        role?: { rubric: RoleRubric; transcript: RoleTranscriptEntry[] };
        voice?: { closeReason: string | null; transcriptComplete: boolean; durationSeconds: number } },
) {
    if (role) preset = frozenRoleAssessment(invitation?.snapshot);
    const legacyInput = [preset, session.currentPlanId, plan, rubric, turns, interrupted, notes, voice, applicationCv];
    const inputHash = hash(role ? [...legacyInput, role, invitation?.snapshot] : legacyInput);
    const previous = await db.aiScreeningEvaluation.findUnique({ where: { sessionId: session.id } });
    if (previous?.result && previous.inputHash === inputHash) return;
    if (await db.aiScreeningCall.count({ where: { subjectId: session.id, task: 'evaluate',
        promptVersion: { not: preset.version }, status: { in: ['RUNNING', 'UNCERTAIN'] } } }))
        throw new AiUncertain('Taka masih merekonsiliasi penilaian terdahulu.');

    const frozen = invitation?.snapshot as { cvScore?: number | null;
        cvResult?: { roleAssessment?: { rubricRevision?: string } } } | undefined;
    const frozenCv = frozen?.cvScore;
    const cvScore = role ? frozen?.cvResult?.roleAssessment?.rubricRevision === role.rubric.revision &&
        typeof frozenCv === 'number' && Number.isFinite(frozenCv) && frozenCv >= 0 && frozenCv <= 100 ? frozenCv : null :
        invitation ? frozenCv ?? null : applicationCv?.assessable ? applicationCv.total : null;
    async function assessLegacy() {
        const evidence = prepareTakaEvidence(plan, turns, rubric.criteria);
        async function assess(claims: CandidatePayload['claims']) {
            const request = takaEvaluationRequest(preset, evidence, claims);
            const raw = await client.run(workId, session.id, 'evaluate', request.data, request.preset);
            return acceptTakaJudgements(evidence, claims.map(claim => claim.id), raw);
        }
        let judgements: Awaited<ReturnType<typeof assess>> = new Map();
        if (plan.claims.length && evidence.catalog.length) {
            judgements = await assess(plan.claims);
            const unresolved = plan.claims.filter(claim => !judgements.has(claim.id));
            if (unresolved.length && unresolved.length < plan.claims.length) {
                try {
                    for (const [id, row] of await assess(unresolved)) judgements.set(id, row);
                } catch (error) {
                    if (error instanceof AiPending) throw error;
                    // Keep the accepted rows when a targeted repair is unavailable.
                }
            }
        }
        const { result, score, coverage } = scoreTakaInterview(evidence, judgements, interrupted, notes);
        return { result, score, assessed: coverage.assessedClaims, total: coverage.plannedClaims,
            ready: ['COMPLETE', 'ALTERNATIVE'].includes(coverage.state),
            finalScore: invitation || coverage.state !== 'COMPLETE' ? null : combineScores(cvScore, score) };
    }
    async function assessRole(context: NonNullable<typeof role>) {
        const evidence = prepareRoleEvidence(context.rubric, context.transcript, plan);
        let judgements: ReturnType<typeof acceptRoleJudgements> = new Map();
        if (evidence.criteria.length && evidence.catalog.length) {
            const request = roleEvaluationRequest(evidence, preset);
            judgements = acceptRoleJudgements(evidence, await client.run(workId, session.id, 'evaluate', request.data, request.preset));
            const unresolved = evidence.criteria.filter(row => !judgements.has(row.id)).map(row => row.id);
            if (unresolved.length && judgements.size) {
                const repair = roleEvaluationRequest(evidence, preset, unresolved);
                try {
                    const raw = await client.run(workId, session.id, 'evaluate', repair.data, repair.preset);
                    for (const [id, row] of acceptRoleJudgements(evidence, raw, unresolved)) judgements.set(id, row);
                } catch (error) {
                    if (error instanceof AiPending) throw error;
                }
            }
        }
        return scoreRoleAssessment(evidence, judgements, cvScore, interrupted, notes);
    }
    const { result, score, finalScore, ready, assessed, total } = role ? await assessRole(role) : await assessLegacy();
    const cvBreakdown = invitation ? frozen?.cvResult : applicationCv;
    const payload = voice ? { ...result, voice: { ...voice, partial: interrupted,
        testedClaims: assessed, totalClaims: total } } : result;
    await db.$transaction(async tx => {
        if (invitation) {
            await tx.$queryRaw`SELECT id FROM "ScreeningInvitation" WHERE id=${invitation.id} FOR UPDATE`;
            const currentInvite = await tx.screeningInvitation.findUnique({ where: { id: invitation.id }, select: { status: true, sessionId: true } });
            if (currentInvite?.sessionId !== session.id || currentInvite.status !== 'COMPLETED') return;
        }
        await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${session.id} FOR UPDATE`;
        const currentSession = await tx.aiScreeningSession.findUnique({ where: { id: session.id },
            select: { revision: true, currentPlanId: true, status: true, applicationId: true } });
        if (currentSession?.status !== (invitation ? 'COMPLETED' : 'SUBMITTED') || currentSession.applicationId !== session.applicationId ||
            currentSession.revision !== session.revision ||
            currentSession.currentPlanId !== session.currentPlanId) return;
        if (owner && !(await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "AiScreeningWork"
            WHERE id=${workId} AND "leaseOwner"=${owner} AND status='RUNNING' FOR UPDATE`).length) return;
        const current = await tx.aiScreeningEvaluation.findUnique({ where: { sessionId: session.id } });
        if (current?.inputHash !== inputHash) {
            const data = { status: ready ? 'READY' : 'NEEDS_REVIEW',
                promptVersion: preset.version, inputHash, model: preset.model, result: json(payload), error: null,
                cvScore, ...(cvBreakdown ? { cvBreakdown: json(cvBreakdown) } : {}),
                screeningScore: score, finalScore, pdfKey: null, pdfVersion: null };
            const saved = await tx.aiScreeningEvaluation.upsert({ where: { sessionId: session.id },
                create: { sessionId: session.id, ...data }, update: data });
            await tx.aiScreeningEvaluationRevision.upsert({ where: { evaluationId_inputHash: { evaluationId: saved.id, inputHash } },
                create: { evaluationId: saved.id, inputHash, promptVersion: preset.version, snapshot: json({ ...saved, promptSnapshot: preset }) },
                update: {} });
        }
        await enqueueEvaluationPdf(tx, session.id, inputHash);
    });
    invalidateHrRanking();
}
