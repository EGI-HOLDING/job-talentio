import { CandidateActions } from './recruitment/candidate-actions.service';
import { VoiceService } from './voice/voice.service';
import { InvitationsService } from './recruitment/invitations.service';
import { RecruitmentService } from './recruitment/recruitment.service';
import { CvScoringService } from './recruitment/cv-scoring.service';
import { CvAssessmentService } from './recruitment/cv-assessment.service';
import { CvWorkDelay } from './recruitment/cv-assessment';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MatchingService } from '../matching/matching.service';
import { hrEnabled, HR_PARSER, evaluateHr, parseHrEvidence } from '../matching/recruiter-ranking';
import { loadHrCatalog } from '../matching/recruiter-ranking.service';
import { hrApplicationProfile, type HrSubmission } from '../matching/recruiter-evidence';
import { withCvFacts } from '../profiles/cv-evidence';
import { extractCvText } from '../profiles/parse/cv-text-extract';
import { ScreeningPackets } from './screening-packets.service';
import { ScreeningSessions } from './screening-sessions.service';
import { ScreeningCandidatePlans } from './screening-candidate-plans.service';
import { ScreeningClient, AiPending, AiUncertain } from './screening.client';
import { hash, json, screeningEnabled, WORK_LEASE_MS, PDF_TEMPLATE_VERSION } from './screening.policy';
import { validatePackage, type PackagePayload, type CandidatePayload, type EvaluationPayload } from './screening.schemas';
import { renderScreeningReport } from './screening-report';
import { currentTaraPrompt, type PromptRegistry } from './prompts/registry';
import { composePrompt } from './prompts/compose';
import { buildCandidatePreparation, CANDIDATE_PREPARATION_MS } from './candidate-preparation';
import { candidatePreparationInclude, candidatePreparationInput, pendingCandidateDraft, publishCandidatePreparation } from './screening-candidate-recovery';
import { enqueueEvaluationPdf, enqueueWork } from './screening-packets.service';
import { conversationTone, isCurrentConversation, requireCurrentConversation } from './conversation.policy';
import { taraAssessmentTopics, taraTopics, taraInterviewReport, validTaraDecision, type TaraProgress, type TaraDecision } from './tara-interview';
import { chatTakaTurns, frozenTakaInterview } from './taka-interview';
import { evaluateTakaInterview } from './taka-evaluation';
import { frozenRoleRubric, rolePackage } from './role-rubric';
import { roleChatTranscript } from './taka-role-assessment';
import { LIVE_AGENDA_PREPARATION_MS, liveAgendaRequest, liveRolePackage, prepareLiveAgenda } from './tara-live-agenda';
import { TAKA_REASSESS_KIND } from './taka-reassessment';
import { TAKA_ROLE_EVIDENCE_VERSION } from './taka-versions';

const agendaProviderError = /^(?:TARA_INVALID_OUTPUT|TARA_PROVIDER_NOT_CONFIGURED|TARA_RESPONSE_FAILED|TARA_PROVIDER_HTTP_\d+|TARA_LIVE_AGENDA_ALREADY_SUBMITTED|TARA_RETRY_LIMIT|SESSION_ERASED)$/;
@Injectable()
export class ScreeningWorker implements OnModuleInit, OnModuleDestroy {
    private logger = new Logger(ScreeningWorker.name);
    private timer?: ReturnType<typeof setInterval>;
    private reconciling = false;
    private ticking = false;
    private stopping = false;
    private queue?: Queue;
    private worker?: Worker;
    private redis?: IORedis;
    private workerRedis?: IORedis;
    private lastReconcile = 0;
    private lastMessageReconcile=0;
    private reconcilingMessages=false;
    private active = new Set<string>();
    constructor(private db: PrismaService, private config: ConfigService, private storage: StorageService, private matching: MatchingService, private packets: ScreeningPackets, private sessions: ScreeningSessions, private candidates: ScreeningCandidatePlans, private client: ScreeningClient, @Optional() private cvScoring?: CvScoringService, @Optional() private recruitment?: RecruitmentService, @Optional() private invitations?: InvitationsService, @Optional() private voice?: VoiceService, @Optional() private actions?: CandidateActions, @Optional() private cvRecovery?: CvAssessmentService) { }
    async onModuleInit() {
        this.stopping = false;
        const exists = await this.db.$queryRaw<Array<{
            name: string | null;
        }>>(Prisma.sql `SELECT to_regclass('public."AiScreeningWork"')::text AS name`).catch(() => []);
        if (!exists[0]?.name) {
            if (screeningEnabled())
                this.logger.error('Tara migrations are required before rollout.');
            return;
        }
        const url = this.config.get<string>('REDIS_URL');
        if (url) {
            this.redis = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500, enableOfflineQueue: false });
            this.redis.on('error', () => undefined);
            try {
                await this.redis.connect();
                this.workerRedis = this.redis.duplicate({ maxRetriesPerRequest: null, enableOfflineQueue: true });
                this.queue = new Queue('tara-screening-v2', { connection: this.redis, defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true } });
                this.worker = new Worker<{
                    workId: string;
                }>('tara-screening-v2', async (job) => this.process(job.data.workId), { connection: this.workerRedis, concurrency: 2 });
                this.queue.on('error', () => undefined);
                this.worker.on('error', () => undefined);
            }
            catch {
                this.redis.disconnect();
                this.logger.warn('Tara uses durable database delivery while Redis is unavailable.');
            }
        }
        this.timer = setInterval(() => void this.tick().catch(() => this.logger.error('Tara recovery tick failed.')), 3000);
        this.timer.unref();
        void this.tick();
    }
    async onModuleDestroy() {
        this.stopping = true;
        if (this.timer)
            clearInterval(this.timer);
        await this.worker?.close();
        await this.queue?.close();
        this.workerRedis?.disconnect();
        this.redis?.disconnect();
    }
    async tick() {
        if (this.stopping || this.ticking)
            return;
        this.ticking = true;
        try {
            await this.sessions.expireAnswers();
            if(this.actions&&!this.reconcilingMessages&&Date.now()-this.lastMessageReconcile>30000){this.lastMessageReconcile=Date.now();this.reconcilingMessages=true;void this.actions.reconcile().catch(()=>this.logger.warn('Candidate message account lookup will retry.')).finally(()=>{this.reconcilingMessages=false;});}
            // Existing evaluations stay frozen. New work is enqueued by explicit lifecycle actions,
            // not by a prompt release or a feature-flag change. Durable pending work still recovers below.
            // Context preparation is requested by an HR invitation; publishing jobs does not incur AI work.
            const now = new Date();
            const due = { OR: [{ status: 'PENDING', availableAt: { lte: now } }, { status: 'RUNNING', leaseUntil: { lte: now } }] };
            // CV imports must not fill the delivery window ahead of live interview follow-ups.
            const bulkKinds = ['CV_SCORE', 'CAPTURE_APPLICATION', 'CV_PROVIDER_DELETE', 'CANDIDATE_RESPONSE', 'LIVE_AGENDA_RESPONSE'];
            const [interactive, imports] = await Promise.all([
                this.db.aiScreeningWork.findMany({ where: { ...due, kind: { notIn: bulkKinds } }, take: 8, orderBy: { availableAt: 'asc' } }),
                this.db.aiScreeningWork.findMany({ where: { ...due, kind: { in: bulkKinds } }, take: 8, orderBy: { availableAt: 'asc' } }),
            ]);
            const works = [...interactive, ...imports];
            for (const work of works) {
                if (this.stopping || this.active.size >= 2)
                    break;
                if (this.queue) {
                    try {
                        await this.queue.add('deliver', { workId: work.id }, { jobId: work.id, priority: bulkKinds.includes(work.kind) ? 10 : 1 });
                        continue;
                    }
                    catch { }
                }
                if (!this.active.has(work.id)) {
                    this.active.add(work.id);
                    let processed = false;
                    void this.process(work.id).then(() => { processed = true; }).catch(() => this.logger.warn('Tara dispatch will retry after its durable lease.')).finally(() => {
                        this.active.delete(work.id);
                        // Fill a free slot immediately; the periodic timer remains the recovery fallback.
                        if (processed && !this.stopping) void this.tick().catch(() => this.logger.warn('Tara dispatch refill will retry.'));
                    });
                }
            }
        }
        finally {
            this.ticking = false;
        }
    }
    async process(id: string) {
        const owner = randomUUID(), now = new Date();
        const claimed = await this.db.aiScreeningWork.updateMany({ where: { id, OR: [{ status: 'PENDING', availableAt: { lte: now } }, { status: 'RUNNING', leaseUntil: { lte: now } }] }, data: { status: 'RUNNING', leaseOwner: owner, leaseUntil: new Date(+now + WORK_LEASE_MS) } });
        if (!claimed.count)
            return;
        const work = await this.db.aiScreeningWork.findUniqueOrThrow({ where: { id } });
        const heartbeat = setInterval(() => void this.db.aiScreeningWork.updateMany({ where: { id, leaseOwner: owner, status: 'RUNNING' }, data: { leaseUntil: new Date(Date.now() + WORK_LEASE_MS) } }).catch(() => undefined), 20000);
        heartbeat.unref();
        try {
            if (work.kind === 'CANDIDATE_DELIVERY')
                await this.actions!.deliver(work.subjectId);
            else if (work.kind === 'VOICE_EVALUATE')
                await this.voice?.evaluate(id, work.subjectId, owner);
            else if (work.kind === TAKA_REASSESS_KIND)
                await this.voice?.evaluate(id, work.subjectId, owner, work.key);
            else if (work.kind === 'INVITE_DELIVERY')
                await this.invitations!.deliver(work.subjectId);
            else if (work.kind === 'CAPTURE_APPLICATION')
                await this.recruitment!.captureApplication(work.subjectId);
            else if (work.kind === 'CV_SCORE')
                await this.cvScoring!.process(id, work.subjectId, owner);
            else if (work.kind === 'CV_PROVIDER_EVENT')
                await this.cvRecovery!.receiveProviderEvent(work.subjectId);
            else if (work.kind === 'CV_PROVIDER_DELETE')
                await this.cvRecovery!.deleteProviderResult(work.subjectId);
            else if (work.kind === 'PREPARE')
                await this.prepare(id, work.subjectId, owner);
            else if (work.kind === 'DOCUMENT')
                await this.document(work.subjectId);
            else if (work.kind === 'CV_SOURCE')
                await this.cvSource(work.subjectId);
            else if (work.kind === 'CANDIDATE')
                await this.candidate(id, work.subjectId, owner);
            else if (work.kind === 'CANDIDATE_RESPONSE')
                await this.reconcileCandidateResponse(work.subjectId);
            else if (work.kind === 'LIVE_AGENDA_RESPONSE')
                await this.reconcileLiveAgendaResponse(work.subjectId);
            else if (work.kind === 'ADVANCE')
                await this.advance(id, work.subjectId);
            else if (work.kind === 'EVALUATE')
                await this.evaluate(id, work.subjectId, owner);
            else if (work.kind === 'PDF')
                await this.pdf(work.subjectId);
            else
                throw new Error('UNKNOWN_WORK_KIND');
            await this.db.aiScreeningWork.updateMany({ where: { id, leaseOwner: owner }, data: { status: 'DONE', leaseUntil: null, leaseOwner: null, error: null } });
        }
        catch (error) {
            if (error instanceof AiPending || error instanceof CvWorkDelay) {
                const delay = error instanceof CvWorkDelay ? error.delayMs : ['CANDIDATE_RESPONSE', 'LIVE_AGENDA_RESPONSE'].includes(work.kind) ? 10_000 : 2000;
                await this.db.aiScreeningWork.updateMany({ where: { id, leaseOwner: owner }, data: { status: 'PENDING', availableAt: new Date(Date.now() + delay), leaseUntil: null, leaseOwner: null } });
                return;
            }
            const message = work.cvPolicy ? 'CV_WORKER_ERROR' : error instanceof Error ? error.message : 'TARA_PROCESSING_FAILED';
            const uncertain = error instanceof AiUncertain;
            if (!uncertain && !work.cvPolicy && !['CANDIDATE', 'CANDIDATE_RESPONSE'].includes(work.kind))
                await this.db.aiScreeningCall.updateMany({ where: { workId: id, status: 'COMPLETED', promptVersion: { not: TAKA_ROLE_EVIDENCE_VERSION } },
                    data: { status: 'INVALID', error: 'DOMAIN_VALIDATION_FAILED' } });
            const retry = !uncertain && work.attempts < 2 && message !== 'CV_UNREADABLE' && message !== 'NO_CV_CLAIMS' && !message.includes('RETIRED_');
            const changed = await this.db.aiScreeningWork.updateMany({ where: { id, leaseOwner: owner }, data: { status: retry ? 'PENDING' : 'FAILED', attempts: { increment: 1 }, availableAt: new Date(Date.now() + 10000), leaseUntil: null, leaseOwner: null, error: message.slice(0, 180) } });
            if (changed.count && !retry)
                await this.failure(work.kind, work.subjectId, message, work.key);
            this.logger.warn('Tara ' + work.kind + ' ' + (retry ? 'retry scheduled' : 'needs recovery') + ' (' + message.slice(0, 80) + ')');
        }
        finally {
            clearInterval(heartbeat);
        }
    }
    private async failure(kind: string, id: string, error: string, workKey?:string) {
        if (kind === 'CANDIDATE_DELIVERY') await this.actions?.failure(id);
        if (kind === 'VOICE_EVALUATE') await this.db.aiScreeningEvaluation.updateMany({where:{sessionId:id,result:{equals:Prisma.DbNull}},data:{status:'FAILED',error}});
        if (kind === 'INVITE_DELIVERY') await this.invitations?.failure(id);
        if (kind === 'CV_SCORE') await this.cvScoring?.failure(id, error, workKey);
        if (kind === 'PREPARE')
            await this.db.aiScreeningPackage.updateMany({ where: { id }, data: { status: 'FAILED', error } });
        if (kind === 'CANDIDATE')
            await this.db.aiCandidatePlan.updateMany({ where: { id, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'FAILED', error } });
        if (kind === 'ADVANCE')
            await this.db.aiScreeningSession.updateMany({ where: { id }, data: { error } });
        if (kind === 'EVALUATE')
            await this.db.aiScreeningEvaluation.updateMany({ where: { sessionId: id, result: { equals: Prisma.DbNull } }, data: { status: 'FAILED', error } });
        if (kind === 'DOCUMENT')
            await this.db.aiCompanyDocument.updateMany({ where: { id }, data: { status: 'FAILED', error } });
        if (kind === 'CV_SOURCE') {
            await this.db.aiCvSource.updateMany({ where: { versionId: id }, data: { status: 'FAILED', error: 'CV_UNREADABLE' } });
            await this.db.aiCandidatePlan.updateMany({ where: { resumeVersionId: id, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'FAILED', error: 'CV_UNREADABLE' } });
        }
    }
    private async prepare(workId: string, id: string, owner: string) {
        const packet = await this.db.aiScreeningPackage.findUnique({ where: { id } });
        if (!packet || packet.status === 'READY' || !isCurrentConversation(packet.conversationPolicy))
            return;
        const newer = await this.db.aiScreeningPackage.count({ where: { jobId: packet.jobId, version: { gt: packet.version } } });
        const pinned = await this.db.aiScreeningSession.count({ where: { packageId: id } });
        const invited = await this.db.screeningInvitation.count({where:{packageId:id,status:{in:['INVITED','STARTED','COMPLETED']}}});
        if (newer && !pinned && !invited) {
            await this.db.aiScreeningPackage.update({ where: { id }, data: { status: 'SUPERSEDED' } });
            return;
        }
        const job = packet.jobSnapshot as Record<string, unknown>, company = packet.companySnapshot;
        const role = frozenRoleRubric(job);
        if (role?.interviewIds.length) {
            const preset = (packet.promptSnapshot as unknown as PromptRegistry)?.liveAgenda;
            if (preset) {
                await this.prepareVoicePackage(workId, id, owner, role, preset);
                return;
            }
            await this.db.aiScreeningPackage.update({ where: { id }, data: { status: 'READY', payload: json(rolePackage(role)), error: null } });
            return;
        }
        const input = { job: { title: job.title, description: job.description, skills: job.jobSkills, languages: job.jobLanguages, experienceLevel: job.experienceLevel, experienceYearsMin: job.experienceYearsMin,
            responsibilities: job.responsibilities,
        }, company };
        const sourceStrings = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(sourceStrings).join(' ') : value && typeof value === 'object' ? Object.values(value).map(sourceStrings).join(' ') : '';
        const payload = validatePackage(await this.client.run(workId, id, 'prepare', input, currentTaraPrompt(packet.promptSnapshot, 'prepare')), sourceStrings(input.job));
        await this.db.aiScreeningPackage.update({ where: { id }, data: { status: 'READY', payload: json(payload), error: null } });
    }

    private async prepareVoicePackage(workId: string, id: string, owner: string, rubric: NonNullable<ReturnType<typeof frozenRoleRubric>>,
        preset: NonNullable<PromptRegistry['liveAgenda']>) {
        const key = workId + ':live-agenda';
        const call = await this.db.aiScreeningCall.findUnique({ where: { key } });
        const deadline = +(call?.createdAt ?? new Date()) + LIVE_AGENDA_PREPARATION_MS;
        let proposal: unknown = call?.status === 'COMPLETED' ? call.result : undefined;
        if (!call || ['RUNNING', 'UNCERTAIN'].includes(call.status) && Date.now() < deadline) {
            try {
                const remaining = Math.max(1, Math.min(12_000, deadline - Date.now()));
                proposal = await this.client.run(workId, id, 'live-agenda', liveAgendaRequest(rubric).data, preset, undefined, remaining);
            } catch (error) {
                if (error instanceof AiPending && Date.now() < deadline) throw error;
                if (!(error instanceof AiPending || error instanceof AiUncertain || error instanceof Error && agendaProviderError.test(error.message))) throw error;
            }
        }
        const agenda = prepareLiveAgenda(rubric, proposal);
        await this.db.$transaction(async tx => {
            const lease = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "AiScreeningWork"
                WHERE id=${workId} AND "leaseOwner"=${owner} AND status='RUNNING' AND "leaseUntil">now() FOR UPDATE`;
            if (!lease.length) return;
            const saved = await tx.aiScreeningPackage.updateMany({ where: { id, status: { in: ['PENDING', 'FAILED'] } },
                data: { status: 'READY', payload: json(liveRolePackage(rubric, agenda)), error: null } });
            if (!saved.count) return;
            const pending = await tx.aiScreeningCall.findUnique({ where: { key } });
            if (pending?.responseId && ['RUNNING', 'UNCERTAIN'].includes(pending.status)) await enqueueWork(tx, 'LIVE_AGENDA_RESPONSE', pending.id);
            this.logger.log(`Tara Live agenda ready source=${agenda.source} topics=${agenda.topics.length} deferred=${agenda.deferredIds.length}`);
        });
    }

    private async reconcileLiveAgendaResponse(id: string) {
        const call = await this.db.aiScreeningCall.findUnique({ where: { id } });
        if (call?.task !== 'live-agenda' || !call.responseId || !['RUNNING', 'UNCERTAIN'].includes(call.status)) return;
        const packet = await this.db.aiScreeningPackage.findUnique({ where: { id: call.subjectId }, select: { promptSnapshot: true } });
        const preset = (packet?.promptSnapshot as unknown as PromptRegistry | undefined)?.liveAgenda;
        if (!preset) return;
        try { await this.client.pollLiveAgenda(call, preset, 12_000); }
        catch (error) {
            if (error instanceof AiPending && Date.now() - +call.createdAt > 900_000) throw new AiUncertain('TARA_AGENDA_RESPONSE_REQUIRES_REVIEW');
            if (error instanceof Error && agendaProviderError.test(error.message)) return;
            throw error;
        }
    }
    private async document(id: string) {
        const document = await this.db.aiCompanyDocument.findUnique({ where: { id } });
        if (!document || document.status === 'READY')
            return;
        const buffer = await this.storage.getObjectBuffer(document.fileKey);
        const extracted = await extractCvText({ buffer, filename: document.filename, mimeType: document.contentType }, this.config);
        await this.db.aiCompanyDocument.update({ where: { id }, data: { status: 'READY', text: extracted.text, error: null } });
        const jobs = await this.db.jobPost.findMany({ where: { companyId: document.companyId, status: 'PUBLISHED' }, select: { id: true } });
        for (const job of jobs)
            await this.packets.sync(job.id);
    }
    private async cvSource(versionId: string) {
        const source = await this.db.aiCvSource.findUnique({ where: { versionId } });
        if (!source || source.status === 'READY')
            return;
        const version = await this.db.resumeVersion.findUnique({ where: { id: versionId } });
        if (!version)
            return;
        const buffer = await this.storage.getObjectBuffer(version.fileKey);
        const checksum = createHash('sha256').update(buffer).digest('hex');
        if (version.checksum && version.checksum !== checksum)
            throw new Error('CV_UNREADABLE');
        const extracted = await extractCvText({ buffer, filename: version.fileKey, mimeType: version.fileKey.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' }, this.config);
        await this.db.aiCvSource.update({ where: { versionId }, data: { status: 'READY', text: extracted.text, checksum, error: null } });
        await this.db.resumeVersion.updateMany({ where: { id: versionId, checksum: null }, data: { checksum } });
    }
    private async candidate(workId: string, id: string, owner: string) {
        const plan = await this.db.aiCandidatePlan.findUnique({ where: { id }, include: candidatePreparationInclude });
        if (!plan || plan.status === 'READY')
            return;
        if (plan.session.status !== 'DRAFT' || plan.session.currentPlanId !== id) {
            await this.db.aiCandidatePlan.updateMany({ where: { id, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'SUPERSEDED' } });
            return;
        }
        if (plan.package.status === 'SUPERSEDED' || !isCurrentConversation(plan.package.conversationPolicy)) {
            await this.candidates.request(plan.sessionId);
            return;
        }
        if (plan.package.status === 'FAILED')
            throw new Error('JOB_CONTEXT_FAILED');
        if (plan.package.status !== 'READY')
            throw new AiPending();
        if (!pendingCandidateDraft(plan)) return;
        const source = plan.resumeVersion.screeningSource;
        if (source?.status === 'FAILED' || source?.status === 'READY' && !source.text?.trim())
            throw new Error('CV_UNREADABLE');
        const context = candidatePreparationInput(plan);
        if (!context)
            throw new AiPending();
        const calls = await this.db.aiScreeningCall.findMany({ where: { workId, task: 'candidate', subjectId: plan.sessionId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        const responses: unknown[] = calls.filter(call => ['COMPLETED', 'INVALID', 'RECOVERED'].includes(call.status) && call.result).map(call => call.result);
        const pending = calls.filter(call => call.status === 'RUNNING' || call.status === 'UNCERTAIN' && call.responseId);
        const deadline = calls.length ? +calls[0].createdAt + CANDIDATE_PREPARATION_MS : Date.now() + CANDIDATE_PREPARATION_MS;
        let alternativeOnly = !responses.length && pending.length > 0 && Date.now() >= deadline;
        if (context.segments.length && !responses.length && !alternativeOnly) {
            try {
                if (!calls.length) {
                    const { input: _input, ...preset } = composePrompt('candidate', {});
                    const model = currentTaraPrompt(plan.package.promptSnapshot, 'candidate').model;
                    responses.push(await this.client.run(workId, plan.sessionId, 'candidate', {
                        job: context.rubric, cvSegments: context.segments, duties: context.job.responsibilities,
                        description: context.job.description, requestedSkills: context.job.jobSkills,
                    }, { ...preset, model }, undefined, CANDIDATE_PREPARATION_MS));
                } else if (pending.length) {
                    if (!pending[0].responseId) throw new AiPending('TARA_CALL_IN_FLIGHT');
                    responses.push(await this.client.pollCandidate(pending[0], Math.max(1, Math.min(12_000, deadline - Date.now()))));
                }
            } catch (error) {
                if (error instanceof AiPending) {
                    if (Date.now() < deadline) throw error;
                    alternativeOnly = true;
                } else if (!(error instanceof AiUncertain) && !(error instanceof Error &&
                    /^(TARA_INVALID_OUTPUT|TARA_PROVIDER_NOT_CONFIGURED|TARA_RESPONSE_FAILED|TARA_PROVIDER_HTTP_\d+|TARA_CANDIDATE_ALREADY_SUBMITTED|TARA_RETRY_LIMIT|SESSION_ERASED)$/.test(error.message))) throw error;
            }
        }
        const unresolved = await this.db.aiScreeningCall.findMany({ where: { workId, task: 'candidate', status: { in: ['RUNNING', 'UNCERTAIN'] },
            responseId: { not: null } }, select: { id: true } });
        const prepared = buildCandidatePreparation(context.segments, context.rubric, context.job, responses, { recoverStored: calls.length > 0, alternativeOnly });
        const outcome = await publishCandidatePreparation(this.db, plan, workId, prepared, { owner, reconcileIds: unresolved.map(call => call.id) });
        if (outcome === 'CHANGED') throw new AiPending('TARA_DRAFT_CHANGED');
        if (outcome === 'READY') this.logger.log(`Tara preparation ready claims=${prepared.payload.claims.length} rejected=${prepared.rejected} waitMs=${Math.max(0, Date.now() - deadline + CANDIDATE_PREPARATION_MS)}`);
    }

    private async reconcileCandidateResponse(id: string) {
        const call = await this.db.aiScreeningCall.findUnique({ where: { id } });
        if (!call?.responseId || call.task !== 'candidate' || !['RUNNING', 'UNCERTAIN'].includes(call.status)) return;
        try { await this.client.pollCandidate(call, 12_000); }
        catch (error) {
            if (error instanceof AiPending && Date.now() - +call.createdAt > 900_000) throw new AiUncertain('TARA_RESPONSE_REQUIRES_REVIEW');
            if (error instanceof Error && ['TARA_INVALID_OUTPUT', 'TARA_RESPONSE_FAILED', 'SESSION_ERASED'].includes(error.message)) return;
            throw error;
        }
    }
    private async advance(workId: string, id: string) {
        const session = await this.db.aiScreeningSession.findUnique({ where: { id }, include: {
            package: true, currentPlan: true, questions: { orderBy: { position: 'asc' } },
        } });
        if (!session || session.status !== 'GENERATING' || session.questions.some(q => q.answer === null)) return;
        requireCurrentConversation(session.package?.conversationPolicy);
        const plan = session.currentPlan!.payload as unknown as CandidatePayload;
        const rubric = session.package!.payload as unknown as PackagePayload;
        const topics = taraTopics(plan, rubric, true);
        const progress = session.taraInterview as unknown as TaraProgress;
        const topic = topics[progress.active], last = session.questions.at(-1)!;
        const previous = session.questions.filter(q => q.claimId === topic.id);
        if ((!session.taraAdvanceAt || +session.taraAdvanceAt <= Date.now())) {
            await this.sessions.advanceTimedChat(id, new Date(), session.revision);
            return;
        }
        let decision: TaraDecision | undefined;
        if (last.answer?.trim()) {
            try {
                decision = validTaraDecision(await this.client.run(workId, id, 'follow-up', {
                    topic, claim: plan.claims.find(claim => claim.id === topic.id),
                    assessmentTopics: taraAssessmentTopics(progress, topics),
                    requirement: topic.requirementRef,
                    chain: previous.map(q => ({ question: q.text, answer: q.answer })),
                    tonePreference: conversationTone(session.questions), recentTaraMessages: session.questions.slice(-2).map(q => q.text),
                }, currentTaraPrompt(session.package!.promptSnapshot, 'follow-up'), undefined,
                Math.max(1, +session.taraAdvanceAt! - Date.now())), last.answer, previous.map(q => q.text), topics);
            } catch (error) {
                if (error instanceof AiPending && +session.taraAdvanceAt! > Date.now()) throw error;
                // Invalid or unavailable analysis cannot close a claim as verified.
            }
        }
        await this.sessions.advanceTimedChat(id, new Date(), session.revision, decision);
    }
    private async cvAssessment(session: {
        profileId: string;
        resumeVersionId: string | null;
        cvSnapshot: unknown;
        startedAt: Date | null;
    }, job: unknown) {
        const snapshot = session.cvSnapshot as {
            submission: HrSubmission;
        };
        const version = session.resumeVersionId ? await this.db.resumeVersion.findUnique({ where: { id: session.resumeVersionId }, include: { screeningSource: true } }) : null;
        if (!version)
            return null;
        if (hrEnabled()) {
            const catalog = await loadHrCatalog(this.db), source = version.screeningSource;
            if (source?.status !== 'READY' || !source.text)
                return null;
            let projection = await this.db.resumeRecruiterEvidence.findUnique({ where: { versionId_parserVersion_catalogRevision: { versionId: version.id, parserVersion: HR_PARSER, catalogRevision: catalog.revision } } });
            if (!projection || projection.status !== 'READY' || projection.generation !== version.parseGeneration) {
                const facts = parseHrEvidence(source.text, catalog);
                projection = await this.db.resumeRecruiterEvidence.upsert({ where: { versionId_parserVersion_catalogRevision: { versionId: version.id, parserVersion: HR_PARSER, catalogRevision: catalog.revision } },
                    create: { versionId: version.id, parserVersion: HR_PARSER, catalogRevision: catalog.revision, status: 'READY', generation: version.parseGeneration, checksum: source.checksum, facts: json(facts) },
                    update: { status: 'READY', generation: version.parseGeneration, checksum: source.checksum, facts: json(facts), revision: { increment: 1 } } });
            }
            return evaluateHr(hrApplicationProfile({ id: session.profileId }, snapshot.submission, version, projection, catalog), job as Parameters<typeof evaluateHr>[1], catalog, session.startedAt ?? new Date());
        }
        if (['PENDING', 'PROCESSING'].includes(version.parseStatus) && Date.now() - +(session.startedAt ?? new Date()) < 300000)
            throw new AiPending();
        if (version.parseStatus !== 'READY')
            return null;
        const profile = { id: session.profileId, languages: snapshot.submission.languages, certifications: snapshot.submission.certifications };
        return this.matching.scoreHistoricalInputs(withCvFacts(profile, version) as never, job as never);
    }
    private async evaluate(workId: string, id: string, owner?: string) {
        const session = await this.db.aiScreeningSession.findUnique({ where: { id }, include: { invitation: true, package: true, currentPlan: true, evaluation: true, questions: { orderBy: { position: 'asc' } } } });
        if (!session || (!session.applicationId && !session.invitation) || !session.currentPlan || !session.package)
            return;
        if (session.evaluation?.result) {
            await this.ensurePdfWork(id);
            return;
        }
        if (session.status !== (session.invitation ? 'COMPLETED' : 'SUBMITTED') ||
            session.invitation && session.invitation.mode !== 'TEXT') return;
        const plan = session.currentPlan.payload as unknown as CandidatePayload;
        const rubric = session.package.payload as unknown as PackagePayload;
        const progress = session.taraInterview as unknown as TaraProgress | null;
        const notes = progress ? taraInterviewReport(progress, taraTopics(plan, rubric, isCurrentConversation(session.package.conversationPolicy))) : undefined;
        const roleRubric = frozenRoleRubric(session.package.jobSnapshot);
        const applicationCv = session.invitation ? undefined : await this.cvAssessment(session, session.package.jobSnapshot);
        await evaluateTakaInterview(this.db, this.client, workId, session, session.invitation,
            frozenTakaInterview(session.invitation?.snapshot, (session.package.promptSnapshot as unknown as PromptRegistry)?.takaInterview),
            plan, roleRubric ? [] : chatTakaTurns(session.questions, notes),
            { rubric, notes, owner, applicationCv, interrupted: progress?.endedReason === 'INTERRUPTED',
                role: roleRubric ? { rubric: roleRubric, transcript: roleChatTranscript(session.questions, notes) } : undefined });
    }
    private async ensurePdfWork(id: string) {
        const evaluation = await this.db.aiScreeningEvaluation.findUnique({ where: { sessionId: id } });
        const work = await enqueueEvaluationPdf(this.db, id, evaluation?.inputHash ?? null);
        if (!evaluation?.pdfKey && work.status === 'DONE') await this.db.aiScreeningWork.updateMany({ where: { id: work.id, status: 'DONE' }, data: { status: 'PENDING', availableAt: new Date() } });
    }
    private async pdf(id: string) {
        const session = await this.db.aiScreeningSession.findUnique({ where: { id }, include: { voice: {include:{fragments:true}}, invitation: true, package: true, currentPlan: true, evaluation: true, questions: { select: { id: true, position: true } }, profile: { select: { user: { select: { fullName: true } } } }, application: { select: { createdAt: true } } } });
        if (!session?.evaluation?.result || !session.package || !session.currentPlan)
            return;
        if (session.evaluation.pdfKey && session.evaluation.pdfVersion === PDF_TEMPLATE_VERSION)
            return;
        const job = session.package.jobSnapshot as {
            title: string;
            company: {
                name: string;
            };
        };
        const buffer = await renderScreeningReport({ name: session.profile.user.fullName, job: job.title, company: job.company.name, submittedAt: session.application?.createdAt ?? session.completedAt ?? session.startedAt ?? session.createdAt,
            independentScores: Boolean(session.invitation), methodology: session.evaluation.promptVersion, jobVersion: session.package.version, cvScore: session.evaluation.cvScore, screeningScore: session.evaluation.screeningScore, finalScore: session.evaluation.finalScore,
            questionLabels: Object.fromEntries([...session.questions.flatMap(q => [[q.id, 'Q' + (q.position + 1)],
                ['answer:' + q.id, 'Q' + (q.position + 1)]]), ...(session.voice?.fragments.map(f=>['v'+f.id, Math.floor(f.startMs/60000)+':'+String(Math.floor(f.startMs/1000)%60).padStart(2,'0')])??[])]), result: session.evaluation.result as unknown as EvaluationPayload, rubric: session.package.payload as unknown as PackagePayload, plan: session.currentPlan.payload as unknown as CandidatePayload });
        const key = 'screening/reports/' + session.evaluation.id + '/' + session.evaluation.inputHash + '/' + PDF_TEMPLATE_VERSION + '.pdf';
        await this.storage.putObject(key, buffer, 'application/pdf');
        const kept = await this.db.aiScreeningEvaluation.updateMany({ where: { id: session.evaluation.id, inputHash: session.evaluation.inputHash }, data: { pdfKey: key, pdfVersion: PDF_TEMPLATE_VERSION } });
        if (!kept.count)
            await this.storage.delete(key);
        else if (session.evaluation.inputHash) {
            const revision = await this.db.aiScreeningEvaluationRevision.findUnique({ where: { evaluationId_inputHash: { evaluationId: session.evaluation.id, inputHash: session.evaluation.inputHash } } });
            if (revision) await this.db.aiScreeningEvaluationRevision.update({ where: { id: revision.id }, data: { snapshot: json({ ...(revision.snapshot as Record<string, unknown>), pdfKey: key, pdfVersion: PDF_TEMPLATE_VERSION }) } });
        }
    }
}
