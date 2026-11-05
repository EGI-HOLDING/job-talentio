import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MatchingService } from '../matching/matching.service';
import { hrEnabled, HR_PARSER, evaluateHr, parseHrEvidence } from '../matching/recruiter-ranking';
import { loadHrCatalog, invalidateHrRanking } from '../matching/recruiter-ranking.service';
import { hrApplicationProfile, type HrSubmission } from '../matching/recruiter-evidence';
import { withCvFacts } from '../profiles/cv-evidence';
import { extractCvText } from '../profiles/parse/cv-text-extract';
import { ScreeningPackets } from './screening-packets.service';
import { ScreeningSessions } from './screening-sessions.service';
import { ScreeningCandidatePlans } from './screening-candidate-plans.service';
import { ScreeningClient, AiPending, AiUncertain } from './screening.client';
import { hash, json, nextProbeTarget, screeningEnabled, WORK_LEASE_MS, scoreScreening, combineScores, SCREENING_PROMPT_VERSION, PDF_TEMPLATE_VERSION } from './screening.policy';
import { validatePackage, validateCandidate, validateFollowUp, validateEvaluation, type PackagePayload, type CandidatePayload, type EvaluationPayload } from './screening.schemas';
import { renderScreeningReport } from './screening-report';
import type { PromptRegistry } from './prompts/registry';
import { composePrompt } from './prompts/compose';
import { assertAnswerOpportunities, unansweredEvaluation, validateClaimEvaluation } from './claim-assessment';
import { enqueueWork } from './screening-packets.service';
import { evidenceCatalog, resolveEvidence } from './evidence-catalog';
import { frozenCvAssessment } from './frozen-cv';
@Injectable()
export class ScreeningWorker implements OnModuleInit, OnModuleDestroy {
    private logger = new Logger(ScreeningWorker.name);
    private timer?: ReturnType<typeof setInterval>;
    private reconciling = false;
    private ticking = false;
    private queue?: Queue;
    private worker?: Worker;
    private redis?: IORedis;
    private workerRedis?: IORedis;
    private lastReconcile = 0;
    private active = new Set<string>();
    private evaluationCursor: string | undefined;
    constructor(private db: PrismaService, private config: ConfigService, private storage: StorageService, private matching: MatchingService, private packets: ScreeningPackets, private sessions: ScreeningSessions, private candidates: ScreeningCandidatePlans, private client: ScreeningClient) { }
    async onModuleInit() {
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
        if (this.timer)
            clearInterval(this.timer);
        await this.worker?.close();
        await this.queue?.close();
        this.workerRedis?.disconnect();
        this.redis?.disconnect();
    }
    async tick() {
        if (this.ticking)
            return;
        this.ticking = true;
        try {
            await this.sessions.expireAnswers();
            if (screeningEnabled()) {
                const completed = await this.db.aiScreeningSession.findMany({ where: { applicationId: { not: null },
                    OR: [{ evaluation: null }, { evaluation: { promptVersion: { not: SCREENING_PROMPT_VERSION } } },
                        { evaluation: { cvScore: null, revisions: { some: {} } } }] },
                    select: { id: true, evaluation: { select: { promptVersion: true } } }, orderBy: { id: 'asc' }, take: 25,
                    ...(this.evaluationCursor ? { cursor: { id: this.evaluationCursor }, skip: 1 } : {}) });
                this.evaluationCursor = completed.length === 25 ? completed.at(-1)!.id : undefined;
                for (const row of completed) await enqueueWork(this.db, 'EVALUATE', row.id, 'EVALUATE:' + row.id + ':' + SCREENING_PROMPT_VERSION + (row.evaluation?.promptVersion === SCREENING_PROMPT_VERSION ? ':restore-cv' : ''));
            }
            if (screeningEnabled() && Date.now() - this.lastReconcile > 60000 && !this.reconciling) {
                this.reconciling = true;
                this.lastReconcile = Date.now();
                void this.packets.reconcile().catch(() => this.logger.warn('Tara packet reconciliation will retry.')).finally(() => { this.reconciling = false; });
            }
            const now = new Date();
            const works = await this.db.aiScreeningWork.findMany({ where: { OR: [{ status: 'PENDING', availableAt: { lte: now } }, { status: 'RUNNING', leaseUntil: { lte: now } }] }, take: 8, orderBy: { availableAt: 'asc' } });
            for (const work of works) {
                if (this.active.size >= 2)
                    break;
                if (this.queue) {
                    try {
                        await this.queue.add('deliver', { workId: work.id }, { jobId: work.id });
                        continue;
                    }
                    catch { }
                }
                if (!this.active.has(work.id)) {
                    this.active.add(work.id);
                    void this.process(work.id).finally(() => this.active.delete(work.id));
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
            if (work.kind === 'PREPARE')
                await this.prepare(id, work.subjectId);
            else if (work.kind === 'DOCUMENT')
                await this.document(work.subjectId);
            else if (work.kind === 'CV_SOURCE')
                await this.cvSource(work.subjectId);
            else if (work.kind === 'CANDIDATE')
                await this.candidate(id, work.subjectId);
            else if (work.kind === 'ADVANCE')
                await this.advance(id, work.subjectId);
            else if (work.kind === 'EVALUATE')
                await this.evaluate(id, work.subjectId);
            else if (work.kind === 'PDF')
                await this.pdf(work.subjectId);
            else
                throw new Error('UNKNOWN_WORK_KIND');
            await this.db.aiScreeningWork.updateMany({ where: { id, leaseOwner: owner }, data: { status: 'DONE', leaseUntil: null, leaseOwner: null, error: null } });
        }
        catch (error) {
            if (error instanceof AiPending) {
                await this.db.aiScreeningWork.updateMany({ where: { id, leaseOwner: owner }, data: { status: 'PENDING', availableAt: new Date(Date.now() + 2000), leaseUntil: null, leaseOwner: null } });
                return;
            }
            const message = error instanceof Error ? error.message : 'TARA_PROCESSING_FAILED';
            const uncertain = error instanceof AiUncertain;
            if (!uncertain)
                await this.db.aiScreeningCall.updateMany({ where: { workId: id, status: 'COMPLETED' }, data: { status: 'INVALID', error: 'DOMAIN_VALIDATION_FAILED' } });
            const retry = !uncertain && work.attempts < 2 && message !== 'CV_UNREADABLE' && message !== 'NO_CV_CLAIMS';
            await this.db.aiScreeningWork.updateMany({ where: { id, leaseOwner: owner }, data: { status: retry ? 'PENDING' : 'FAILED', attempts: { increment: 1 }, availableAt: new Date(Date.now() + 10000), leaseUntil: null, leaseOwner: null, error: message.slice(0, 180) } });
            if (!retry)
                await this.failure(work.kind, work.subjectId, message);
            this.logger.warn('Tara ' + work.kind + ' ' + (retry ? 'retry scheduled' : 'needs recovery') + ' (' + message.slice(0, 80) + ')');
        }
        finally {
            clearInterval(heartbeat);
        }
    }
    private async failure(kind: string, id: string, error: string) {
        if (kind === 'PREPARE')
            await this.db.aiScreeningPackage.updateMany({ where: { id }, data: { status: 'FAILED', error } });
        if (kind === 'CANDIDATE')
            await this.db.aiCandidatePlan.updateMany({ where: { id }, data: { status: 'FAILED', error } });
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
    private async prepare(workId: string, id: string) {
        const packet = await this.db.aiScreeningPackage.findUnique({ where: { id } });
        if (!packet || packet.status === 'READY')
            return;
        const newer = await this.db.aiScreeningPackage.count({ where: { jobId: packet.jobId, version: { gt: packet.version } } });
        const pinned = await this.db.aiScreeningSession.count({ where: { packageId: id, startedAt: { not: null } } });
        if (newer && !pinned) {
            await this.db.aiScreeningPackage.update({ where: { id }, data: { status: 'SUPERSEDED' } });
            return;
        }
        const job = packet.jobSnapshot as Record<string, unknown>, company = packet.companySnapshot;
        const input = { job: { title: job.title, description: job.description, skills: job.jobSkills, languages: job.jobLanguages, experienceLevel: job.experienceLevel, experienceYearsMin: job.experienceYearsMin }, company };
        const sourceStrings = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(sourceStrings).join(' ') : value && typeof value === 'object' ? Object.values(value).map(sourceStrings).join(' ') : '';
        const payload = validatePackage(await this.client.run(workId, id, 'prepare', input, (packet.promptSnapshot as unknown as PromptRegistry).prepare), sourceStrings(input.job));
        await this.db.aiScreeningPackage.update({ where: { id }, data: { status: 'READY', payload: json(payload), error: null } });
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
    private async candidate(workId: string, id: string) {
        const plan = await this.db.aiCandidatePlan.findUnique({ where: { id }, include: { package: true, session: { include: { profile: { select: { user: { select: { fullName: true } } } } } }, resumeVersion: { include: { screeningSource: true } } } });
        if (!plan || plan.status === 'READY')
            return;
        if (plan.session.status !== 'DRAFT' || plan.session.currentPlanId !== id) {
            await this.db.aiCandidatePlan.update({ where: { id }, data: { status: 'SUPERSEDED' } });
            return;
        }
        if (plan.package.status === 'SUPERSEDED') {
            await this.candidates.request(plan.sessionId);
            return;
        }
        if (plan.package.status === 'FAILED')
            throw new Error('JOB_CONTEXT_FAILED');
        if (plan.package.status !== 'READY')
            throw new AiPending();
        const source = plan.resumeVersion.screeningSource;
        if (source?.status === 'FAILED')
            throw new Error('CV_UNREADABLE');
        if (!source?.text || source.status !== 'READY')
            throw new AiPending();
        const name = plan.session.profile.user.fullName.toLocaleLowerCase().trim();
        const cvLines = source.text.split('\n').map((text, i) => ({ line: i + 1, text })).filter(r => r.text.trim().toLocaleLowerCase() !== name && !/@/.test(r.text) && !/^\s*[+\d ()-]{8,}\s*$/.test(r.text));
        const payload = validateCandidate(await this.client.run(workId, plan.sessionId, 'candidate', { job: plan.package.payload, cvLines }, (plan.package.promptSnapshot as unknown as PromptRegistry).candidate), plan.package.payload as unknown as PackagePayload, source.text);
        await this.db.aiCandidatePlan.update({ where: { id }, data: { status: 'READY', payload: json(payload), error: null } });
    }
    private async advance(workId: string, id: string) {
        for (let turn = 0; turn < 5; turn++) {
            const session = await this.db.aiScreeningSession.findUnique({ where: { id }, include: { package: true, currentPlan: true, questions: { orderBy: { position: 'asc' } } } });
            if (!session || session.status !== 'GENERATING' || session.questions.some(q => q.answer === null))
                return;
            const target = nextProbeTarget(session.questions);
            if (!target) {
                await this.db.aiScreeningSession.updateMany({ where: { id, status: 'GENERATING', revision: session.revision }, data: { status: 'COMPLETED', completedAt: new Date(), error: null } });
                return;
            }
            const plan = session.currentPlan?.payload as unknown as CandidatePayload;
            const claim = plan.claims.find(c => c.id === target.root.claimId)!;
            const rubric = session.package!.payload as unknown as PackagePayload;
            const chain = session.questions.filter(q => q.id === target.root.id || q.rootQuestionId === target.root.id).map(q => ({ id: q.id, depth: q.depth, question: q.text, answer: q.answer }));
            const response = validateFollowUp(await this.client.run(workId, id, 'follow-up', { context: rubric.context, criterion: rubric.criteria.find(c => c.id === claim.criterionId), claim, targetDepth: target.depth, rootQuestionId: target.root.id, chain }, (session.package!.promptSnapshot as unknown as PromptRegistry)['follow-up']));
            if (response.stop) {
                await this.db.aiScreeningQuestion.update({ where: { id: target.root.id }, data: { probeClosed: true } });
                continue;
            }
            await this.db.$transaction(async (tx) => {
                await tx.$queryRaw(Prisma.sql `SELECT id FROM "AiScreeningSession" WHERE id=${id} FOR UPDATE`);
                const current = await tx.aiScreeningSession.findUniqueOrThrow({ where: { id } });
                if (current.status !== 'GENERATING' || current.revision !== session.revision)
                    return;
                await tx.aiScreeningQuestion.create({ data: { sessionId: id, position: session.questions.length, claimId: claim.id, criterionId: claim.criterionId, kind: 'FOLLOW_UP', rootQuestionId: target.root.id, parentQuestionId: target.parent.id, depth: target.depth, text: response.question! } });
                await tx.aiScreeningSession.update({ where: { id }, data: { status: 'ACTIVE', error: null } });
            });
            return;
        }
        throw new AiPending();
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
    private async evaluate(workId: string, id: string) {
        const session = await this.db.aiScreeningSession.findUnique({ where: { id }, include: { package: true, currentPlan: true, evaluation: true, questions: { orderBy: { position: 'asc' } } } });
        if (!session?.applicationId || !session.currentPlan || !session.package)
            return;
        const revisions = session.evaluation && session.evaluation.cvScore === null ? await this.db.aiScreeningEvaluationRevision.findMany({ where: { evaluationId: session.evaluation.id }, select: { snapshot: true }, orderBy: { createdAt: 'asc' } }) : [];
        const frozenCv = frozenCvAssessment(session.evaluation, revisions);
        const currentResult = session.evaluation?.result && session.evaluation.promptVersion === SCREENING_PROMPT_VERSION ? session.evaluation.result as unknown as EvaluationPayload : null;
        if (currentResult && (session.evaluation!.cvScore !== null || !frozenCv)) {
            await this.ensurePdfWork(id);
            return;
        }
        const rubric = session.package.payload as unknown as PackagePayload, plan = session.currentPlan.payload as unknown as CandidatePayload;
        const cv = frozenCv ?? await this.cvAssessment(session, session.package.jobSnapshot);
        const answers = session.questions.map(q => ({ id: q.id, claimId: q.claimId, criterionId: q.criterionId, rootQuestionId: q.rootQuestionId, parentQuestionId: q.parentQuestionId, depth: q.depth, kind: q.kind, question: q.text, answer: q.answer, shownAt: q.shownAt, answeredAt: q.answeredAt, timedOut: q.timedOut }));
        assertAnswerOpportunities(plan, answers);
        const { input: _input, ...preset } = composePrompt('evaluate', {});
        const model = process.env.TARA_SCREENING_MODEL ?? 'gpt-6-luna';
        const fingerprint = hash([SCREENING_PROMPT_VERSION, model, preset, session.currentPlan.fingerprint, answers, cv?.total]);
        let result: EvaluationPayload;
        if (currentResult) {
            // Restore CV/composite deterministically; the accepted Tara result is unchanged.
            result = currentResult;
        }
        else if (!answers.some(a => a.answer?.trim())) {
            result = unansweredEvaluation(rubric, plan, answers);
        }
        else {
            const catalog = evidenceCatalog(plan, answers);
            result = validateClaimEvaluation(resolveEvidence(await this.client.run(workId, id, 'evaluate', { context: rubric.context, claims: plan.claims, limitations: plan.limitations, answers, evidenceCatalog: catalog }, { ...preset, model }), catalog), rubric, plan, answers);
        }
        const screening = scoreScreening(result.claims.map(c => ({ score: c.score! }))), cvScore = cv?.assessable ? cv.total : null, final = combineScores(cvScore, screening);
        const retained = await this.db.aiScreeningSession.count({ where: { id, applicationId: session.applicationId } });
        if (!retained)
            return;
        await this.db.$transaction(async tx => {
            await tx.$queryRaw(Prisma.sql`SELECT id FROM "AiScreeningSession" WHERE id=${id} FOR UPDATE`);
            const retained = await tx.aiScreeningSession.findUnique({ where: { id } });
            if (!retained?.applicationId) return;
            const previous = await tx.aiScreeningEvaluation.findUnique({ where: { sessionId: id } });
            if (previous?.inputHash === fingerprint) return;
            if (previous?.result) await tx.aiScreeningEvaluationRevision.upsert({
                where: { evaluationId_inputHash: { evaluationId: previous.id, inputHash: previous.inputHash ?? hash(previous.result) } },
                create: { evaluationId: previous.id, inputHash: previous.inputHash ?? hash(previous.result), promptVersion: previous.promptVersion, snapshot: json(previous) }, update: {} });
            const data = { promptVersion: SCREENING_PROMPT_VERSION, status: final === null ? 'NEEDS_REVIEW' : 'READY', inputHash: fingerprint, model,
                result: json(result), cvScore, cvBreakdown: cv ? json(cv) : Prisma.DbNull, screeningScore: screening, finalScore: final, error: null, pdfKey: null, pdfVersion: null };
            const current = await tx.aiScreeningEvaluation.upsert({ where: { sessionId: id }, create: { sessionId: id, ...data }, update: data });
            await tx.aiScreeningEvaluationRevision.upsert({ where: { evaluationId_inputHash: { evaluationId: current.id, inputHash: fingerprint } },
                create: { evaluationId: current.id, inputHash: fingerprint, promptVersion: SCREENING_PROMPT_VERSION, snapshot: json({ ...current, promptSnapshot: preset }) }, update: {} });
        });
        invalidateHrRanking();
        await this.ensurePdfWork(id);
    }
    private async ensurePdfWork(id: string) {
        const evaluation = await this.db.aiScreeningEvaluation.findUnique({ where: { sessionId: id } });
        const work = await enqueueWork(this.db, 'PDF', id, 'PDF:' + id + ':' + (evaluation?.inputHash ?? 'legacy') + ':' + PDF_TEMPLATE_VERSION);
        if (!evaluation?.pdfKey && work.status === 'DONE') await this.db.aiScreeningWork.updateMany({ where: { id: work.id, status: 'DONE' }, data: { status: 'PENDING', availableAt: new Date() } });
    }
    private async pdf(id: string) {
        const session = await this.db.aiScreeningSession.findUnique({ where: { id }, include: { package: true, currentPlan: true, evaluation: true, questions: { select: { id: true, position: true } }, profile: { select: { user: { select: { fullName: true } } } }, application: { select: { createdAt: true } } } });
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
        const buffer = await renderScreeningReport({ name: session.profile.user.fullName, job: job.title, company: job.company.name, submittedAt: session.application!.createdAt,
            methodology: session.evaluation.promptVersion, jobVersion: session.package.version, cvScore: session.evaluation.cvScore, screeningScore: session.evaluation.screeningScore, finalScore: session.evaluation.finalScore,
            questionLabels: Object.fromEntries(session.questions.map(q => [q.id, 'Q' + (q.position + 1)])), result: session.evaluation.result as unknown as EvaluationPayload, rubric: session.package.payload as unknown as PackagePayload, plan: session.currentPlan.payload as unknown as CandidatePayload });
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
