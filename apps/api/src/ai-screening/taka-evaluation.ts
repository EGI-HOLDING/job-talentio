import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { CandidatePayload, PackagePayload } from './screening.schemas';
import type { PromptPreset } from './prompts/compose';
import { AiEvaluationOutputError, AiPending, AiUncertain, type ScreeningClient } from './screening.client';
import { enqueueEvaluationPdf } from './screening-packets.service';
import { combineScores, hash, json } from './screening.policy';
import { acceptTakaJudgements, prepareTakaEvidence, scoreTakaInterview, takaEvaluationRequest } from './taka-interview';
import type { taraInterviewReport } from './tara-interview';
import { invalidateHrRanking } from '../matching/recruiter-ranking.service';
import type { RoleRubric } from './role-rubric';
import { acceptRoleJudgements, frozenRoleAssessment, prepareRoleEvidence, roleEvaluationRequest,
    scoreRoleAssessment, type RoleAssessment, type RoleTranscriptEntry } from './taka-role-assessment';
import { acceptRoleEvidence, roleEvidenceReferences, roleEvidenceRequest } from './taka-role-evidence';
import { TAKA_LIVE_COMPLETION_VERSION, TAKA_ROLE_EVIDENCE_VERSION, TAKA_ROLE_VALIDATION_VERSION } from './taka-versions';
import { acceptLiveEvidence, liveEvidenceRequest, liveReviewLabels, missingLiveOpportunity,
    type FrozenLiveEvidencePrompt, type LiveEvidenceDiagnostic } from './taka-live-evidence';
import { liveCompletion, liveCompletionDecision, type LiveCompletion } from './voice/voice-completion';
import { savedTakaResponses } from './taka-reassessment';
import { composePrompt } from './prompts/compose';

export async function evaluateTakaInterview(
    db: PrismaService, client: ScreeningClient, workId: string,
    session: { id: string; revision: number; currentPlanId: string | null; applicationId: string | null },
    invitation: { id: string; snapshot: unknown } | null,
    preset: PromptPreset, plan: CandidatePayload, turns: Parameters<typeof prepareTakaEvidence>[1],
    { interrupted, notes, owner, voice, rubric, applicationCv, role, reassess, completion }: { interrupted: boolean; notes?: ReturnType<typeof taraInterviewReport>; owner?: string;
        rubric: PackagePayload;
        applicationCv?: { assessable: boolean; total: number } | null;
        role?: { rubric: RoleRubric; transcript: RoleTranscriptEntry[]; direct?: boolean; evidenceV2?: boolean };
        completion?: { value: LiveCompletion; lastEndedAt: Date; replacementUsed: boolean; cannotResume: boolean };
        voice?: { closeReason: string | null; transcriptComplete: boolean; durationSeconds: number };
        reassess?: { previous: string; savedResponseOnly: boolean; verify: (tx: Prisma.TransactionClient) => Promise<boolean> } },
) {
    if (role) preset = frozenRoleAssessment(invitation?.snapshot);
    const legacyInput = [preset, session.currentPlanId, plan, rubric, turns, interrupted, notes, voice, applicationCv];
    const roleInput = role ? [...legacyInput, role, invitation?.snapshot] : legacyInput;
    const inputHash = hash([...roleInput, ...(role?.evidenceV2 ? [TAKA_ROLE_VALIDATION_VERSION] : []),
        ...(reassess ? [{ reassessedFrom: reassess.previous }] : []),
        ...(completion ? [TAKA_LIVE_COMPLETION_VERSION, completion.value.evidenceRevision, completion.value.retained] : []),
        ...(completion?.value.evaluationRepair ? [{ evaluationRepair: completion.value.evaluationRepair }] : [])]);
    const previous = await db.aiScreeningEvaluation.findUnique({ where: { sessionId: session.id } });
    if (!completion && previous?.result && previous.inputHash === inputHash) return;
    if (reassess && previous?.inputHash !== reassess.previous) return;
    if (await db.aiScreeningCall.count({ where: { subjectId: session.id, task: 'evaluate',
        workId: { not: workId }, status: { in: ['RUNNING', 'UNCERTAIN'] } } }))
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
    async function assessRole(context: NonNullable<typeof role>): Promise<ReturnType<typeof scoreRoleAssessment> & {
        liveDecision?: { assessmentFailed: boolean; missingCriterionIds: string[]; retained: NonNullable<LiveCompletion['retained']> };
    }> {
        const evidence = prepareRoleEvidence(context.rubric, context.transcript, plan);
        if (completion) {
            const storedPrompt = (invitation?.snapshot as { liveEvidencePrompt?: string } | null)?.liveEvidencePrompt;
            const frozenPrompt = storedPrompt ? JSON.parse(storedPrompt) as FrozenLiveEvidencePrompt : undefined;
            const ids = evidence.criteria.map(row => row.id);
            const refs = roleEvidenceReferences(evidence);
            const judgements = new Map(completion.value.retained ?? []);
            const diagnostics = new Map<string, LiveEvidenceDiagnostic>();
            const requested = ids.filter(id => !judgements.has(id));
            const manualRecovery = Boolean(completion.value.evaluationRepair);
            const previousGrades = (previous?.result as { roleAssessment?: RoleAssessment } | null)?.roleAssessment?.criteria ?? [];
            const recoveryHints = manualRecovery ? new Map<string, LiveEvidenceDiagnostic>(previousGrades.flatMap(grade =>
                grade.reviewReasons?.length ? [[grade.criterionId, { questionRefs: grade.questionRefs,
                    reasons: grade.reviewReasons as LiveEvidenceDiagnostic['reasons'] }]] : [])) : undefined;
            async function assessRows(targets: string[], slot: 'primary' | 'repair') {
                const isRepair = slot === 'repair' || manualRecovery;
                const request = liveEvidenceRequest(evidence, refs, targets, slot === 'repair' ? diagnostics : recoveryHints, frozenPrompt);
                try {
                    const raw = await client.run(workId, session.id, 'evaluate', request.data, request.preset, undefined, undefined, slot);
                    const verdict = acceptLiveEvidence(evidence, refs, raw, targets, { repair: isRepair });
                    for (const [id, grade] of verdict.accepted) {
                        judgements.set(id, grade);
                        const issue = diagnostics.get(id);
                        if (issue && (grade.level !== null || issue.reasons.every(reason => reason === 'INSUFFICIENT_WITH_ANSWER')))
                            diagnostics.delete(id);
                    }
                    for (const [id, issue] of verdict.diagnostics) {
                        const prior = diagnostics.get(id);
                        diagnostics.set(id, { ...issue, questionRefs: [...new Set([...issue.questionRefs, ...(prior?.questionRefs ?? [])])] });
                    }
                } catch (error) {
                    if (!(error instanceof AiEvaluationOutputError)) throw error;
                    for (const id of targets)
                        if (!diagnostics.has(id)) diagnostics.set(id, { questionRefs: [], reasons: ['INVALID_OUTPUT'] });
                }
            }
            if (requested.length && refs.answers.size) {
                await assessRows(requested, 'primary');
                const unresolved = requested.filter(id => diagnostics.has(id));
                if (unresolved.length && !manualRecovery) await assessRows(unresolved, 'repair');
            }
            const unavailable = new Set(ids.filter(id => {
                const issue = diagnostics.get(id);
                const grade = judgements.get(id);
                return grade?.level == null && Boolean(issue && !missingLiveOpportunity(issue));
            }));
            const recordedDiagnostics = new Map([...diagnostics].map(([id, diagnostic]) =>
                [id, { ...diagnostic, labels: diagnostic.reasons.map(reason => liveReviewLabels[reason]) }]));
            const scored = scoreRoleAssessment(evidence, judgements, cvScore, interrupted, notes, { unavailable, diagnostics: recordedDiagnostics,
                includePartial: false, version: TAKA_LIVE_COMPLETION_VERSION });
            return { ...scored, liveDecision: {
                assessmentFailed: unavailable.size > 0,
                missingCriterionIds: ids.filter(id => judgements.get(id)?.level == null && !unavailable.has(id)),
                retained: [...judgements].filter(([, row]) => row.level !== null),
            } };
        }
        if (context.evidenceV2) {
            const ids = evidence.criteria.map(row => row.id);
            const refs = roleEvidenceReferences(evidence);
            const judgements: ReturnType<typeof acceptRoleEvidence> = new Map();
            const assessable = Boolean(ids.length && (refs.answers.size || refs.questions.size));
            let uncertain = false;
            async function assessRows(requested: string[], slot: 'primary' | 'repair') {
                const request = roleEvidenceRequest(evidence, refs, requested, slot === 'repair');
                try {
                    const raw = await client.run(workId, session.id, 'evaluate', request.data, request.preset, undefined, undefined, slot);
                    for (const [id, row] of acceptRoleEvidence(evidence, refs, raw, requested)) judgements.set(id, row);
                } catch (error) {
                    if (error instanceof AiUncertain) uncertain = true;
                    else if (!(error instanceof AiEvaluationOutputError)) throw error;
                }
            }
            if (reassess?.savedResponseOnly) {
                const saved = await savedTakaResponses(db, session.id, reassess.previous);
                const previousContract = [{ ...preset, version: TAKA_ROLE_EVIDENCE_VERSION }, ...roleInput.slice(1)];
                if (!saved || hash([...previousContract, { reassessedFrom: saved.from }]) !== saved.evaluationHash)
                    throw new Error('TAKA_SAVED_EVIDENCE_CHANGED');
                const primary = roleEvidenceRequest(evidence, refs, ids);
                function stored(request: typeof primary, slot: 'primary' | 'repair') {
                    const inputHash = hash([composePrompt('evaluate', request.data, request.preset), request.preset.model, undefined]);
                    return saved?.calls.find(row => row.key.endsWith(':' + slot) && row.inputHash === inputHash)?.result;
                }
                const raw = stored(primary, 'primary');
                const reviews = acceptRoleEvidence(evidence, refs, raw, ids, { requireVerifiedPlayback: true });
                for (const [id, row] of acceptRoleEvidence(evidence, refs, raw, ids)) judgements.set(id, row);
                const unresolved = ids.filter(id => !reviews.has(id));
                const repair = stored(roleEvidenceRequest(evidence, refs, unresolved, true), 'repair');
                for (const [id, row] of acceptRoleEvidence(evidence, refs, repair, unresolved)) {
                    if (!judgements.has(id)) judgements.set(id, row);
                }
                if (!judgements.size) throw new Error('TAKA_SAVED_EVIDENCE_REQUIRES_REVIEW');
            } else if (assessable) {
                await assessRows(ids, 'primary');
                const unresolved = ids.filter(id => !judgements.has(id));
                if (!uncertain && unresolved.length) await assessRows(unresolved, 'repair');
            }
            return scoreRoleAssessment(evidence, judgements, cvScore, interrupted, notes,
                { unavailable: new Set(assessable ? ids.filter(id => !judgements.has(id)) : []) });
        }
        let judgements: ReturnType<typeof acceptRoleJudgements> = new Map();
        if (evidence.criteria.length && evidence.catalog.length) {
            const request = roleEvaluationRequest(evidence, preset, undefined, context.direct);
            judgements = acceptRoleJudgements(evidence, await client.run(workId, session.id, 'evaluate', request.data, request.preset));
            const unresolved = evidence.criteria.filter(row => !judgements.has(row.id)).map(row => row.id);
            if (unresolved.length && judgements.size) {
                const repair = roleEvaluationRequest(evidence, preset, unresolved, context.direct);
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
    const roleResult = role ? await assessRole(role) : undefined;
    const assessedResult = roleResult ?? await assessLegacy();
    const { result, score, finalScore, ready, assessed, total } = assessedResult;
    if (completion && !assessedResult.result.roleAssessment) throw new Error('TAKA_LIVE_RUBRIC_MISSING');
    const liveDecision = roleResult?.liveDecision;
    const cvBreakdown = invitation ? frozen?.cvResult : applicationCv;
    const payload = voice ? { ...result, voice: { ...voice, partial: interrupted,
        testedClaims: assessed, totalClaims: total } } : result;
    const saved = await db.$transaction(async tx => {
        if (invitation) {
            await tx.$queryRaw`SELECT id FROM "ScreeningInvitation" WHERE id=${invitation.id} FOR UPDATE`;
            const currentInvite = await tx.screeningInvitation.findUnique({ where: { id: invitation.id }, select: { status: true, sessionId: true } });
            if (currentInvite?.sessionId !== session.id || currentInvite.status !== (completion ? 'STARTED' : 'COMPLETED')) return;
        }
        await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${session.id} FOR UPDATE`;
        const currentSession = await tx.aiScreeningSession.findUnique({ where: { id: session.id },
            select: { revision: true, currentPlanId: true, status: true, applicationId: true, voiceDeadlineAt: true, voiceCompletion: true } });
        if (currentSession?.status !== (completion ? 'ACTIVE' : invitation ? 'COMPLETED' : 'SUBMITTED') || currentSession.applicationId !== session.applicationId ||
            currentSession.revision !== session.revision ||
            currentSession.currentPlanId !== session.currentPlanId) return;
        if (owner && !(await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "AiScreeningWork"
            WHERE id=${workId} AND "leaseOwner"=${owner} AND status='RUNNING' FOR UPDATE`).length) return;
        const live = liveCompletion(currentSession.voiceCompletion);
        const next = completion && live && liveDecision ? liveCompletionDecision(live, {
            finalScore, cvMissing: cvScore === null, deadline: currentSession.voiceDeadlineAt,
            replacementUsed: completion.replacementUsed || completion.cannotResume, cannotResume: completion.cannotResume,
            interrupted, assessmentFailed: liveDecision.assessmentFailed, missingCriterionIds: liveDecision.missingCriterionIds, now: Date.now(),
        }) : undefined;
        if (completion && (!next || !live || live.evidenceRevision !== completion.value.evidenceRevision ||
            live.evaluationRepair !== completion.value.evaluationRepair || !['ASSESSING', 'REVIEW_REQUIRED'].includes(live.status))) return;
        const current = await tx.aiScreeningEvaluation.findUnique({ where: { sessionId: session.id } });
        if (current?.inputHash !== inputHash) {
            if (reassess && (current?.inputHash !== reassess.previous || !await reassess.verify(tx))) return;
            if (current?.result && !reassess && !completion) return;
            const assessmentPreset = completion ? { ...preset, version: TAKA_LIVE_COMPLETION_VERSION } :
                role?.evidenceV2 ? { ...preset, version: TAKA_ROLE_VALIDATION_VERSION } : preset;
            const data = { status: ready ? 'READY' : 'NEEDS_REVIEW',
                promptVersion: assessmentPreset.version, inputHash, model: preset.model, result: json(payload), error: null,
                cvScore, ...(cvBreakdown ? { cvBreakdown: json(cvBreakdown) } : {}),
                screeningScore: score, finalScore, pdfKey: null, pdfVersion: null };
            const saved = await tx.aiScreeningEvaluation.upsert({ where: { sessionId: session.id },
                create: { sessionId: session.id, ...data }, update: data });
            await tx.aiScreeningEvaluationRevision.upsert({ where: { evaluationId_inputHash: { evaluationId: saved.id, inputHash } },
                create: { evaluationId: saved.id, inputHash, promptVersion: assessmentPreset.version, snapshot: json({ ...saved, promptSnapshot: assessmentPreset }) },
                update: {} });
        } else if (completion && current.status === 'PENDING') {
            await tx.aiScreeningEvaluation.update({ where: { sessionId: session.id },
                data: { status: ready ? 'READY' : 'NEEDS_REVIEW', error: null } });
        }
        if (next && invitation && completion) {
            const terminal = next.status === 'COMPLETE' || next.status === 'INTERRUPTED';
            const state = next.status === 'COMPLETE' ? 'COMPLETED' : 'INTERRUPTED';
            await tx.aiScreeningSession.update({ where: { id: session.id }, data: {
                voiceCompletion: json({ ...next, assessedEvidenceRevision: next.evidenceRevision,
                    retained: next.status === 'RESUMABLE' || next.status === 'REVIEW_REQUIRED' ? liveDecision?.retained : undefined,
                    ...(next.status === 'REVIEW_REQUIRED' && next.reason === 'ASSESSMENT' ? { canRetry: true } : {}),
                    ...(completion.cannotResume && next.status === 'INTERRUPTED' ? { reason: 'CONNECTION_UNCONFIRMED' } : {}) }),
                revision: { increment: 1 },
                ...(terminal ? { status: state, completedAt: completion.lastEndedAt } : {}),
            } });
            if (terminal) await tx.screeningInvitation.update({ where: { id: invitation.id }, data: { status: state } });
            if (next.status === 'RESUMABLE') return true;
            if (next.status === 'REVIEW_REQUIRED' && owner) {
                await tx.aiScreeningWork.updateMany({ where: { id: workId, leaseOwner: owner, status: 'RUNNING' },
                    data: { status: 'FAILED', error: next.reason === 'CV' ? 'TAKA_FROZEN_CV_INVALID' : 'TAKA_ASSESSMENT_REVIEW',
                        leaseOwner: null, leaseUntil: null } });
            }
        }
        await enqueueEvaluationPdf(tx, session.id, inputHash);
        return true;
    });
    if (completion && !saved) throw new AiPending('TAKA_LIVE_WRITE_SUPERSEDED');
    invalidateHrRanking();
}
