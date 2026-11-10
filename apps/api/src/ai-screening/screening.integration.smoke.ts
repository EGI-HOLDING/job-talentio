import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { ApplicationsService } from '../applications/applications.service';
import { UserErasureService } from '../users/user-erasure.service';
import { ScreeningPackets } from './screening-packets.service';
import { ScreeningCandidatePlans } from './screening-candidate-plans.service';
import { ScreeningSessions } from './screening-sessions.service';
import { ScreeningWorker } from './screening-worker.service';
import { ScreeningHr } from './screening-hr.service';
import { ScreeningClient, AiPending } from './screening.client';
import { validateCandidate, validateEvaluation, type CandidatePayload, type PackagePayload, type EvaluationPayload } from './screening.schemas';
import { CURRENT_CONVERSATION, V4_CONVERSATION, LEGACY_CONVERSATION } from './conversation.policy';
import { Prisma } from '@prisma/client';
import { combineScores, rankScreening, scoreScreening, json } from './screening.policy';
async function main() {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '5434');
    assert.match(url.pathname, /^\/talentio_tara_it_\d+$/);
    const db = new PrismaService(), objects = new Map<string, Buffer>(), calls: Array<{
        task: string;
        input: any;
        preset?: any;
    }> = [];
    let checks = 0;
    const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
    const storage = { getObjectBuffer: async (key: string) => objects.get(key)!, putObject: async (key: string, b: Buffer) => { objects.set(key, b); }, delete: async (key: string) => { objects.delete(key); }, keyFromPublicUrl: () => null, getPresignedGetUrl: async (key: string) => 'https://private.example/' + encodeURIComponent(key), upload: async (buffer: Buffer, name: string, _mime: string, folder: string) => { const key = folder + '/' + Date.now() + '-' + name; objects.set(key, buffer); return { key, url: 'private' }; } };
    const config = new ConfigService({ CV_PARSE_OCR: 'false' });
    const rubric: PackagePayload = { context: 'Pekerjaan dukungan pelanggan dan pencatatan hasil.', criteria: ['Layanan', 'Proses', 'Hasil'].map((name, i) => ({ id: 'c' + i, name, requirementRef: 'layanan pelanggan', anchors: ['Tidak memadai', 'Terbatas', 'Cukup', 'Kuat', 'Sangat kuat'] })) };
    const hrUser = await db.user.create({ data: { id: 'hr', fullName: 'Synthetic HR', role: 'RECRUITER' } }) as any;
    const company = await db.company.create({ data: { id: 'co', name: 'Synthetic Company', slug: 'tara-test', members: { create: { userId: hrUser.id, role: 'OWNER' } } } });
    const companies = { assertMember: async (user: any, id: string) => {
            if (user.id !== hrUser.id || id !== company.id)
                throw Error('Forbidden company');
        } };
    const packets = new ScreeningPackets(db), plans = new ScreeningCandidatePlans(db, packets), sessions = new ScreeningSessions(db, storage as never, companies as never, packets, config, plans), hr = new ScreeningHr(db, companies as never, storage as never), matching = new MatchingService(db);
    const app = new ApplicationsService(db, storage as never, companies as never, matching, { create: async () => { } } as never, {} as never, undefined, undefined, undefined, sessions, hr);
    let outage = false;
    let candidateHook: (() => Promise<void>) | undefined;
    const provider = { run: async (_work: string, _subject: string, task: string, input: any, preset?: any) => {
            calls.push({ task, input, preset });
            if (outage && task === 'follow-up')
                throw new AiPending('SYNTHETIC_OUTAGE');
            if (task === 'prepare')
                return rubric;
            if (task === 'candidate') {
                if (candidateHook) await candidateHook();
                return { claims: input.cvLines.filter((l: any) => l.text.includes('Membantu')).slice(0, 3).map((l: any, i: number) => ({ id: 'claim' + i, criterionId: 'c' + i, statement: l.text, quote: l.text, lineStart: l.line, lineEnd: l.line, question: 'Di CV kamu menyebut ' + l.text + '. Bagian apa yang kamu kerjakan sendiri?' })), limitations: [] };
            }
            if (task === 'follow-up')
                return { stop: false, question: input.targetDepth === 1 ? 'Kamu menyebut ' + input.chain[0].answer + '. Bagaimana urutan tindakanmu?' : 'Tadi kamu menjelaskan ' + input.chain[1].answer + '. Bagaimana kamu mengukur hasilnya?' };
            return { summary: 'Kandidat menjelaskan kontribusi dengan contoh konkret.', strengths: ['Kontribusi pribadi dijelaskan.'], gaps: ['Konfirmasikan hasil saat wawancara.'], interviewQuestions: ['Bagaimana kamu mengukur hasil pekerjaanmu?'], claims: input.claims.map((c: any) => ({ claimId: c.id, ...(preset?.schema?.properties?.claims?.items?.properties?.judgement ? { judgement: { level: 'CONCRETE', detail: 'NONE', detailRef: null } } : { score: 3 }), status: 'SUPPORTED', reason: 'Jawaban menjelaskan peran kandidat.', evidence: [{ questionId: input.answers.find((a: any) => a.claimId === c.id).id, quoteRef: input.evidenceCatalog.find((s: any) => s.source === 'ANSWER' && s.ref === input.answers.find((a: any) => a.claimId === c.id).id).id }], contradictions: [] })) };
        } };
    const worker = new ScreeningWorker(db, config, storage as never, matching, packets, sessions, plans, provider as never);
    const job = await db.jobPost.create({ data: { id: 'job', companyId: company.id, title: 'Customer Service', description: 'Menangani layanan pelanggan, mencatat proses dan mengukur hasil layanan pelanggan.', status: 'PUBLISHED' } });
    async function deliver(kind: string, subjectId?: string) {
        const works = await db.aiScreeningWork.findMany({ where: { kind, ...(subjectId ? { subjectId } : {}), status: { in: ['PENDING', 'RUNNING'] } }, orderBy: { createdAt: 'asc' } });
        for (const w of works) {
            await db.aiScreeningWork.update({ where: { id: w.id }, data: { availableAt: new Date(0) } });
            await worker.process(w.id);
            const after = await db.aiScreeningWork.findUniqueOrThrow({ where: { id: w.id } });
            assert.equal(after.status, 'DONE', after.error ?? kind + ' should finish');
        }
    }
    async function candidate(id: string, claimText = 'Membantu tim menangani layanan pelanggan') {
        const user = await db.user.create({ data: { id, fullName: 'Synthetic ' + id, role: 'EMPLOYEE' } }) as any;
        await db.employeeProfile.create({ data: { id, userId: id, phone: '+62812345678' + id.charCodeAt(0) } });
        const resume = await db.resume.create({ data: { id: 'r' + id, profileId: id, title: 'CV ' + id, fileKey: 'fixture/' + id + '.pdf', parseStatus: 'READY', parseGeneration: 1, parsedData: { headline: 'Customer Service', skills: [], experiences: [], educations: [] } } });
        const d = await sessions.draft(user, job.id) as any;
        await sessions.save(user, d.id, { resumeId: resume.id });
        await sessions.claim(user, d.id, 'preparation-tab');
        const callsBeforeStart = calls.length;
        const waiting = await sessions.start(user, d.id, 'preparation-tab');
        check(waiting.status === 'DRAFT' && waiting.preparation.status === 'PROCESSING', 'start before readiness returns a normal draft');
        check(!waiting.startedAt && !waiting.questions.length && calls.length === callsBeforeStart, 'waiting never starts a timer, creates questions or calls AI');
        await assert.rejects(() => sessions.start(user, d.id, 'other-tab'));
        checks++;
        await db.aiScreeningSession.update({ where: { id: d.id }, data: { leaseToken: null, leaseExpiresAt: null } });
        if (id === 'a') {
            const current = await db.aiScreeningSession.findUniqueOrThrow({ where: { id: d.id } });
            const work = await db.aiScreeningWork.findUniqueOrThrow({ where: { key: 'CANDIDATE:' + current.currentPlanId } });
            await db.aiCandidatePlan.update({ where: { id: current.currentPlanId! }, data: { status: 'FAILED', error: 'SYNTHETIC_TRANSIENT' } });
            await db.aiScreeningWork.update({ where: { id: work.id }, data: { status: 'FAILED', attempts: 1, error: 'SYNTHETIC_TRANSIENT' } });
            check((await sessions.state(user, d.id)).preparation.reason === 'PREPARATION_FAILED', 'recoverable preparation failures expose a safe UI reason');
            check((await sessions.retry(user, d.id)).preparation.status === 'PROCESSING', 'retry atomically clears failed dependency state');
            await db.aiCandidatePlan.update({ where: { id: current.currentPlanId! }, data: { status: 'FAILED', error: 'SYNTHETIC_INVALID' } });
            await db.aiScreeningWork.update({ where: { id: work.id }, data: { status: 'FAILED', attempts: 3 } });
            check((await sessions.state(user, d.id)).preparation.reason === 'RECOVERY_REQUIRED', 'exhausted recovery budget does not offer futile retries');
            await assert.rejects(() => sessions.retry(user, d.id)); checks++;
            await db.aiCandidatePlan.update({ where: { id: current.currentPlanId! }, data: { status: 'PENDING', error: null } });
            await db.aiScreeningWork.update({ where: { id: work.id }, data: { status: 'PENDING', attempts: 0, error: null } });
        }
        const row = await db.aiScreeningSession.findUniqueOrThrow({ where: { id: d.id } });
        const text = [claimText, 'Membantu mencatat proses layanan', 'Membantu tim menilai hasil layanan'].join('\n');
        const pdf = new PDFDocument(), chunks: Buffer[] = [];
        const completed = new Promise<Buffer>(resolve => { pdf.on('data', b => chunks.push(b)); pdf.on('end', () => resolve(Buffer.concat(chunks))); });
        pdf.fontSize(10).text(text);
        pdf.end();
        objects.set(resume.fileKey!, await completed);
        await db.resumeVersion.update({ where: { id: row.resumeVersionId! }, data: { parseStatus: 'READY', matchingData: { headline: 'Customer Service', skills: [], experiences: [], educations: [] } } });
        await deliver('PREPARE');
        await deliver('CV_SOURCE');
        check((await db.aiCvSource.findUniqueOrThrow({ where: { versionId: row.resumeVersionId! } })).text?.includes('Membantu'), 'local PDF extraction preserves CV claims');
        await deliver('CANDIDATE');
        return { user, resume, id: d.id };
    }
    try {
        const a = await candidate('a'), b = await candidate('b', 'Membantu tim belajar layanan pelanggan melalui magang');
        const pa = await db.aiScreeningSession.findUniqueOrThrow({ where: { id: a.id }, include: { currentPlan: true } }), pb = await db.aiScreeningSession.findUniqueOrThrow({ where: { id: b.id }, include: { currentPlan: true } });
        const plan = pa.currentPlan!.payload as unknown as CandidatePayload;
        check(JSON.stringify(pa.currentPlan!.payload) !== JSON.stringify(pb.currentPlan!.payload), 'different CV produces grounded personal questions');
        check(plan.claims[0].quote.startsWith('Membantu tim'), 'scope retained');
        assert.throws(() => validateCandidate({ ...plan, claims: [{ ...plan.claims[0], quote: 'Memimpin perusahaan' }] }, rubric, 'Membantu tim'));
        checks++;
        // Applications are now CV-only; ownership, rather than Tara completion, gates the selected CV.
        await assert.rejects(() => app.apply(a.user, job.id, undefined, undefined, b.resume.id));
        checks++;
        await assert.rejects(() => sessions.state(b.user, a.id));
        checks++;
        const secondCv = await db.resume.create({ data: { id: 'replacement-b', profileId: b.user.id, title: 'CV revisi', fileKey: 'fixture/replacement-b.pdf' } });
        const staleWork = await db.aiScreeningWork.findUniqueOrThrow({ where: { key: 'CANDIDATE:' + pb.currentPlanId } });
        await db.aiCandidatePlan.update({ where: { id: pb.currentPlanId! }, data: { status: 'PENDING' } });
        await db.aiScreeningWork.update({ where: { id: staleWork.id }, data: { status: 'PENDING', availableAt: new Date(0) } });
        let releaseCandidate!: () => void, enteredCandidate!: () => void;
        const entered = new Promise<void>(resolve => enteredCandidate = resolve);
        const release = new Promise<void>(resolve => releaseCandidate = resolve);
        candidateHook = async () => { enteredCandidate(); await release; };
        const oldDelivery = worker.process(staleWork.id);
        await entered;
        await sessions.save(b.user, b.id, { resumeId: secondCv.id });
        releaseCandidate(); await oldDelivery; candidateHook = undefined;
        check((await db.aiCandidatePlan.findUniqueOrThrow({ where: { id: pb.currentPlanId! } })).status === 'SUPERSEDED', 'in-flight old plan is superseded when CV changes');
        check((await db.aiScreeningSession.findUniqueOrThrow({ where: { id: b.id } })).currentPlanId !== pb.currentPlanId, 'CV replacement invalidates the previous candidate plan');
        const legacyJob = await db.jobPost.create({ data: { companyId: company.id, title: 'Legacy customer service', description: job.description, status: 'PUBLISHED' } });
        const basePacket = await db.aiScreeningPackage.findUniqueOrThrow({ where: { id: pa.packageId! } });
        const legacyPrompts = structuredClone(basePacket.promptSnapshot) as any;
        legacyPrompts['follow-up'].instructions = 'LEGACY_VOICE_FIXTURE';
        legacyPrompts['follow-up'].version = 'tara-cv-claims-v3.0.0';
        const legacyPacket = await db.aiScreeningPackage.create({ data: { jobId: legacyJob.id, fingerprint: 'legacy-policy-fixture', version: 1, status: 'READY', jobSnapshot: basePacket.jobSnapshot!, companySnapshot: basePacket.companySnapshot!, promptSnapshot: json(legacyPrompts), promptVersion: 'tara-cv-claims-v3.0.0', payload: json(rubric), conversationPolicy: Prisma.DbNull } });
        const legacy = await db.aiScreeningSession.create({ data: { jobId: legacyJob.id, profileId: b.user.id, legacyKey: 'legacy:'+legacyJob.id+':'+b.user.id, resumeId: b.resume.id, packageId: legacyPacket.id, resumeVersionId: pb.resumeVersionId, status: 'ACTIVE', startedAt: new Date() } });
        const legacyPlan = await db.aiCandidatePlan.create({ data: { sessionId: legacy.id, packageId: legacyPacket.id, resumeVersionId: pb.resumeVersionId!, fingerprint: 'legacy-claims', promptVersion: 'tara-cv-claims-v3.0.0', status: 'READY', payload: json({ claims: [plan.claims[0]], limitations: [] }) } });
        await db.aiScreeningSession.update({ where: { id: legacy.id }, data: { currentPlanId: legacyPlan.id } });
        const legacyQuestion = await db.aiScreeningQuestion.create({ data: { sessionId: legacy.id, position: 0, claimId: plan.claims[0].id, criterionId: 'c0', kind: 'CORE', text: 'Bagian apa yang kamu kerjakan sendiri?' } });
        await sessions.claim(b.user, legacy.id, 'legacy-tab-unique');
        await sessions.shown(b.user, legacy.id, 'legacy-tab-unique', legacyQuestion.id);
        const legacyState = await sessions.state(b.user, legacy.id);
        check(legacyState.conversationPolicy.questionSeconds === 60 && legacyState.conversationPolicy.maxQuestions === 15, 'legacy response preserves the old limits');
        check(+legacyState.questions[0].deadlineAt! - +legacyState.questions[0].shownAt! === 60000, 'legacy active timer stays at 60 seconds');
        check((await sessions.draft(b.user, legacyJob.id) as any).id === legacy.id, 'reopening legacy active session keeps its identity');
        check((await db.aiScreeningSession.findUniqueOrThrow({ where: { id: legacy.id } })).packageId === legacyPacket.id, 'legacy active package is never replaced');
        await sessions.answer(b.user, legacy.id, 'legacy-tab-unique', legacyQuestion.id, 'Saya menangani pelanggan.', true);
        await deliver('ADVANCE', legacy.id);
        const legacyFollow = (await sessions.state(b.user, legacy.id)).questions.find(q => q.answer === null)!;
        await sessions.shown(b.user, legacy.id, 'legacy-tab-unique', legacyFollow.id);
        await sessions.answer(b.user, legacy.id, 'legacy-tab-unique', legacyFollow.id, 'Saya mencatat hasilnya.', true);
        await deliver('ADVANCE', legacy.id);
        check(calls.filter(c => c.task === 'follow-up' && c.preset?.instructions === 'LEGACY_VOICE_FIXTURE').length === 2, 'legacy followups use the exact frozen voice preset');
        check((await db.aiScreeningQuestion.count({ where: { sessionId: legacy.id } })) === 3, 'legacy per-root second followup is preserved');
        const v4job = await db.jobPost.create({ data: { companyId: company.id, title: 'v4 customer service', description: job.description, status: 'PUBLISHED' } });
        const v4packet = await db.aiScreeningPackage.create({ data: { jobId: v4job.id, fingerprint: 'v4-policy-fixture', version: 1, status: 'READY', jobSnapshot: basePacket.jobSnapshot!, companySnapshot: basePacket.companySnapshot!, promptSnapshot: json(legacyPrompts), promptVersion: V4_CONVERSATION.version, payload: json(rubric), conversationPolicy: json(V4_CONVERSATION) } });
        const v4session = await db.aiScreeningSession.create({ data: { jobId: v4job.id, profileId: b.user.id, legacyKey: 'legacy:'+v4job.id+':'+b.user.id, packageId: v4packet.id, status: 'ACTIVE', startedAt: new Date() } });
        const v4question = await db.aiScreeningQuestion.create({ data: { sessionId: v4session.id, position: 0, criterionId: 'c0', claimId: plan.claims[0].id, kind: 'CORE', text: 'Bagian apa yang lu kerjakan?' } });
        await sessions.claim(b.user, v4session.id, 'v4-tab-unique');
        await sessions.shown(b.user, v4session.id, 'v4-tab-unique', v4question.id);
        const v4state = await sessions.state(b.user, v4session.id);
        check(v4state.conversationPolicy.questionSeconds === 30 && +v4state.questions[0].deadlineAt! - +v4state.questions[0].shownAt! === 30000, 'active v4 session keeps 30-second policy');
        await sessions.draft(b.user, v4job.id);
        check((await db.aiScreeningSession.findUniqueOrThrow({ where: { id: v4session.id } })).packageId === v4packet.id, 'active v4 session never upgrades its packet');
        const legacyDraft = await db.aiScreeningSession.create({ data: { jobId: legacyJob.id, profileId: a.user.id, legacyKey: 'legacy:'+legacyJob.id+':'+a.user.id, resumeId: a.resume.id, packageId: legacyPacket.id, resumeVersionId: pa.resumeVersionId } });
        const reopened = await sessions.draft(a.user, legacyJob.id) as any;
        check(reopened.id === legacyDraft.id && reopened.conversationPolicy.version === CURRENT_CONVERSATION.version && reopened.preparation.status === 'PROCESSING', 'old draft gets new preparation on reopen');
        check((await db.aiScreeningSession.findUniqueOrThrow({ where: { id: legacyDraft.id } })).packageId !== legacyPacket.id, 'old draft is regenerated rather than truncated');
        const beforeReuse = calls.length;
        await sessions.save(b.user, b.id, { resumeId: b.resume.id });
        check((await db.aiScreeningSession.findUniqueOrThrow({ where: { id: b.id } })).currentPlanId === pb.currentPlanId && calls.length === beforeReuse, 'unchanged source plan is reused without AI');
        await assert.rejects(() => sessions.uploadCover(b.user, b.id, { buffer: Buffer.from('invalid'), originalname: 'bad.pdf', mimetype: 'application/pdf', size: 7 }));
        checks++;
        await sessions.uploadCover(b.user, b.id, { buffer: Buffer.from('%PDF-1.4 synthetic cover'), originalname: 'cover.pdf', mimetype: 'application/pdf', size: 24 });
        const uploaded = await db.aiScreeningSession.findUniqueOrThrow({ where: { id: b.id } });
        await sessions.save(b.user, b.id, { coverLetter: 'Surat pengantar ringkas', removeCoverFile: true });
        check(!objects.has(uploaded.coverFileKey!), 'switching to written cover removes the private uploaded file');
        await sessions.claim(a.user, a.id, 'tab-one-unique');
        await assert.rejects(() => sessions.claim(a.user, a.id, 'tab-two-unique'));
        checks++;
        await sessions.start(a.user, a.id, 'tab-one-unique');
        await assert.rejects(() => sessions.save(a.user, a.id, { resumeId: b.resume.id }));
        checks++;
        let state = await sessions.state(a.user, a.id);
        check(!JSON.stringify(state).includes('fixture/'), 'candidate response hides storage keys');
        check(state.questions.length === 1, 'one question visible at a time');
        let q = state.questions[0];
        await sessions.shown(a.user, a.id, 'tab-one-unique', q.id);
        const first = await sessions.state(a.user, a.id);
        check(first.conversationPolicy.questionSeconds === 60 && first.conversationPolicy.maxQuestions === 25, 'current policy exposes 60 seconds and the twenty-five-question cap');
        check(+first.questions[0].deadlineAt! - +first.questions[0].shownAt! === 60000, 'new timer uses the pinned policy');
        await sessions.shown(a.user, a.id, 'tab-one-unique', q.id);
        check((await sessions.state(a.user, a.id)).questions[0].deadlineAt?.getTime() === first.questions[0].deadlineAt?.getTime(), 'refresh acknowledgment does not reset timer');
        await sessions.answer(a.user, a.id, 'tab-one-unique', q.id, 'Saya menghubungi pelanggan.', false);
        await db.aiScreeningQuestion.update({ where: { id: q.id }, data: { deadlineAt: new Date(Date.now() - 1) } });
        await sessions.expireAnswers();
        check((await db.aiScreeningQuestion.findUniqueOrThrow({ where: { id: q.id } })).answer === 'Saya menghubungi pelanggan.', 'timeout locks last saved draft');
        const oldPacket = pa.packageId;
        await db.jobPost.update({ where: { id: job.id }, data: { description: job.description + ' Tanggung jawab tambahan.' } });
        const newer = await packets.sync(job.id);
        check(newer!.id !== oldPacket, 'job edit creates new context');
        check((await db.aiScreeningSession.findUniqueOrThrow({ where: { id: a.id } })).packageId === oldPacket, 'active session stays pinned');
        let outageTested = false;
        for (let turn = 0; turn < 16; turn++) {
            state = await sessions.state(a.user, a.id);
            if (state.status === 'COMPLETED')
                break;
            if (state.status === 'GENERATING') {
                if (!outageTested) {
                    const work = await db.aiScreeningWork.findFirstOrThrow({ where: { kind: 'ADVANCE', subjectId: a.id, status: 'PENDING' } });
                    outage = true;
                    await worker.process(work.id);
                    outage = false;
                    check((await sessions.state(a.user, a.id)).status === 'GENERATING', 'provider outage preserves conversation progress');
                    check((await db.aiScreeningQuestion.count({ where: { sessionId: a.id } })) === 3, 'API wait creates no answering timer or duplicate question');
                    outageTested = true;
                }
                await deliver('ADVANCE', a.id);
                continue;
            }
            q = state.questions.find(v => v.answer === null)!;
            await sessions.shown(a.user, a.id, 'tab-one-unique', q.id);
            await Promise.all([sessions.answer(a.user, a.id, 'tab-one-unique', q.id, 'Saya mencatat urutan kerja.', true), sessions.answer(a.user, a.id, 'tab-one-unique', q.id, 'Saya mencatat urutan kerja.', true)]);
        }
        state = await sessions.state(a.user, a.id);
        check(state.status === 'COMPLETED', 'conversation completes');
        const questions = await db.aiScreeningQuestion.findMany({ where: { sessionId: a.id }, orderBy: { position: 'asc' } });
        check(questions.length === 9 && questions.filter(q => q.kind === 'CORE').length === 3, 'three available roots receive two followups each without fabricating extra claims to fill the twenty-five-question cap');
        check(questions.filter(q => q.kind === 'FOLLOW_UP').slice(0, 3).every(q => q.depth === 1), 'breadth-first gives every root a first followup');
        check(new Set(questions.filter(q => q.depth === 1).map(q => q.rootQuestionId)).size === 3, 'all three roots get an opportunity');
        for (const q of questions.filter(q => q.depth === 2)) {
            const parent = questions.find(p => p.id === q.parentQuestionId)!;
            check(parent.depth === 1 && parent.rootQuestionId === q.rootQuestionId, 'second followup follows first followup');
        }
        const [submitted, again] = await Promise.all([app.finalizeScreening(a.user, a.id, 'id'), app.finalizeScreening(a.user, a.id, 'id')]);
        check(submitted.id === again.id, 'finalization idempotent under duplicate clicks');
        check(await db.application.count() === 1, 'one candidate-job application');
        const oldConfiguredModel = process.env.TARA_SCREENING_MODEL;
        process.env.TARA_SCREENING_MODEL = 'fixture-runtime-model-change';
        try { await deliver('EVALUATE', a.id); } finally { if (oldConfiguredModel === undefined) delete process.env.TARA_SCREENING_MODEL; else process.env.TARA_SCREENING_MODEL = oldConfiguredModel; }
        const evaluation = await db.aiScreeningEvaluation.findUniqueOrThrow({ where: { sessionId: a.id } });
        check(evaluation.screeningScore === 75, 'rubric score normalized by backend');
        const frozenEvaluationModel = ((await db.aiScreeningPackage.findUniqueOrThrow({ where: { id: oldPacket! } })).promptSnapshot as any).evaluate.model;
        check(evaluation.model === frozenEvaluationModel, 'assessment uses the frozen model after runtime configuration changes');
        check(calls.filter(c => c.task === 'evaluate').at(-1)?.preset?.version === 'tara-cv-claims-v3.0.3', 'assessment uses the frozen preset version');
        const frozenMethodologyCalls = calls.length;
        await db.aiScreeningEvaluation.update({ where: { id: evaluation.id }, data: { promptVersion: 'tara-cv-claims-v3.0.0' } });
        await db.aiScreeningWork.create({ data: { key: 'preserve-v3-score', kind: 'EVALUATE', subjectId: a.id } });
        await deliver('EVALUATE', a.id);
        check((await db.aiScreeningEvaluation.findUniqueOrThrow({ where: { id: evaluation.id } })).promptVersion === 'tara-cv-claims-v3.0.0' && calls.length === frozenMethodologyCalls, 'accepted old scores are retained after assessment prompt clarification');
        await db.aiScreeningEvaluation.update({ where: { id: evaluation.id }, data: { promptVersion: evaluation.promptVersion } });
        const before = calls.length;
        await deliver('PDF', a.id);
        await hr.assessment(hrUser, submitted.id);
        await hr.pdf(hrUser, submitted.id);
        await hr.pdf(hrUser, submitted.id);
        check(calls.length === before, 'PDF downloads and HR views use no AI calls');
        const report = await db.aiScreeningEvaluation.findUniqueOrThrow({ where: { sessionId: a.id } });
        fs.mkdirSync('output/pdf', { recursive: true });
        fs.writeFileSync('output/pdf/tara-screening-synthetic.pdf', objects.get(report.pdfKey!)!);
        await assert.rejects(() => hr.assessment({ id: 'outsider', role: 'RECRUITER' } as any, submitted.id));
        checks++;
        const group = await hr.project({ ids: [submitted.id], scores: new Map(), total: 1, page: 1, totalPages: 1 }, { page: 1, limit: 10 });
        check(group.tara.has(submitted.id), 'HR projection includes screening metadata');
        const frozenScore = 80; // Simulate a previously assessed CV on the legacy evaluation.
        objects.set('reports/legacy-fixture.pdf', Buffer.from('legacy fixture'));
        await db.aiScreeningEvaluation.update({ where: { id: evaluation.id }, data: { promptVersion: 'tara-cv-claims-v2.0.0', inputHash: 'legacy-fixture', pdfKey: 'reports/legacy-fixture.pdf', cvScore: frozenScore, cvBreakdown: json({ ...(report.cvBreakdown as object), total: frozenScore, assessable: true }) } });
        await db.aiScreeningWork.create({ data: { key: 'reassess-test', kind: 'EVALUATE', subjectId: a.id } });
        await deliver('EVALUATE', a.id);
        const reassessed = await db.aiScreeningEvaluation.findUniqueOrThrow({ where: { id: evaluation.id } });
        check(reassessed.promptVersion === 'tara-cv-claims-v3.0.3' && reassessed.screeningScore === 75, 'old assessment promoted to claim methodology');
        check(reassessed.cvScore === frozenScore && reassessed.finalScore === combineScores(frozenScore, 75), 'Tara revision preserves frozen CV score');
        check(await db.aiScreeningEvaluationRevision.count({ where: { evaluationId: evaluation.id } }) === 3, 'initial, legacy and current assessments retained');
        const legacyRevision = await db.aiScreeningEvaluationRevision.findFirstOrThrow({ where: { evaluationId: evaluation.id, inputHash: 'legacy-fixture' } });
        const historical = await hr.revision(hrUser, submitted.id, legacyRevision.id);
        check(historical.pdfUrl?.includes('legacy-fixture.pdf') && !('snapshot' in historical), 'authorized revision exposes report without private prompt snapshot');
        await assert.rejects(() => hr.revision({ id: 'outsider', role: 'RECRUITER' } as any, submitted.id, legacyRevision.id)); checks++;
        const repeatedCalls = calls.length;
        await db.aiScreeningWork.create({ data: { key: 'duplicate-reassess-test', kind: 'EVALUATE', subjectId: a.id } });
        await deliver('EVALUATE', a.id);
        check(calls.length === repeatedCalls, 'current methodology is not reevaluated on duplicate delivery');
        await db.aiScreeningEvaluation.update({ where: { id: evaluation.id }, data: { cvScore: null, cvBreakdown: json({ total: 0, assessable: false }), finalScore: null, inputHash: 'damaged-v3-fixture' } });
        await db.aiScreeningWork.create({ data: { key: 'restore-cv-test', kind: 'EVALUATE', subjectId: a.id } });
        await deliver('EVALUATE', a.id);
        const restored = await db.aiScreeningEvaluation.findUniqueOrThrow({ where: { id: evaluation.id } });
        check(restored.cvScore === frozenScore && restored.finalScore === combineScores(frozenScore, 75) && restored.screeningScore === 75, 'historical CV snapshot restores composite without changing Tara');
        check(calls.length === repeatedCalls, 'CV restoration uses no AI calls');
        await deliver('PDF', a.id);
        const ranks = rankScreening([{ id: 'x', createdAt: new Date(0), packageId: 'v1', finalScore: 80, status: 'READY' }, { id: 'y', createdAt: new Date(1), packageId: 'v1', finalScore: 80, status: 'READY' }, { id: 'z', createdAt: new Date(0), packageId: 'v2', finalScore: 70, status: 'READY' }]);
        check(ranks.ranks.get('x') === 1 && ranks.ranks.get('y') === 1 && ranks.ranks.get('z') === 1, 'ties and versions ranked independently');
        check(combineScores(null, 75) === null && scoreScreening([{ score: null }]) === null, 'missing evidence never becomes zero');
        const valid = evaluation.result as unknown as EvaluationPayload;
        assert.throws(() => validateEvaluation({ ...valid, criteria: valid.criteria.map((c, i) => i ? c : { ...c, evidence: [{ questionId: questions[0].id, quote: 'fabricated evidence' }] }) }, rubric, plan, questions));
        checks++;
        const providerConfig = new ConfigService({ OPENAI_API_KEY: 'test-only' }), realClient = new ScreeningClient(db, providerConfig);
        const original = globalThis.fetch;
        let networkCalls = 0;
        try {
            globalThis.fetch = (async () => { networkCalls++; throw Error('Synthetic network loss'); }) as typeof fetch;
            await assert.rejects(() => realClient.run('uncertain-work', a.id, 'follow-up', {}));
            await assert.rejects(() => realClient.run('uncertain-work', a.id, 'follow-up', {}));
            check(networkCalls === 1, 'ambiguous POST is not repeated blindly');
        }
        finally {
            globalThis.fetch = original;
        }
        const bulkIds = Array.from({ length: 1000 }, (_, i) => 'load-' + i);
        await db.user.createMany({ data: bulkIds.map(id => ({ id, fullName: 'Synthetic load fixture', role: 'EMPLOYEE' })) });
        await db.employeeProfile.createMany({ data: bulkIds.map(id => ({ id, userId: id })) });
        await db.application.createMany({ data: bulkIds.map(id => ({ id, jobPostId: job.id, profileId: id })) });
        await db.aiScreeningSession.createMany({ data: bulkIds.map((id, i) => ({ id, profileId: id, jobId: job.id, packageId: i % 2 ? newer!.id : oldPacket!, status: 'SUBMITTED', applicationId: id, startedAt: new Date() })) });
        await db.aiScreeningEvaluation.createMany({ data: bulkIds.map((id, i) => ({ sessionId: id, promptVersion: 'tara-cv-claims-v2.0.0', status: i === 999 ? 'PENDING' : 'READY', cvScore: 80, screeningScore: 80, finalScore: i === 999 ? null : i / 10 })) });
        const loadCalls = calls.length;
        for (const size of [50, 100, 200, 300, 400, 500, 750, 1000]) {
            const base = { ids: bulkIds.slice(0, size), scores: new Map(), total: size, page: 1, totalPages: 1 };
            const page = await hr.project(base, { page: 1, limit: 10 });
            check(page.total === size && page.ids[0] === 'load-' + (size === 1000 ? 997 : size - 1), 'ranking selects strongest applicant before pagination at ' + size);
            const newestPage = await hr.project(base, { page: Math.ceil(size / 10), limit: 10, sort: 'newest' });
            check(newestPage.ids.length === 10, 'last page retains candidates at ' + size);
        }
        const detail = await app.getForJob(hrUser, job.id, 'load-995', 'id');
        check(detail.tara?.rank === 2, 'detail rank uses the complete version pool rather than a one-row pool');
        check(calls.length === loadCalls, '50–1,000 applicant listing never calls AI');
        // Reproduce a bounded database delay inside the atomic erasure transaction.
        // The default five-second transaction budget previously rolled back all cleanup.
        let erasureTransactionBudget: number | undefined;
        const delayedErasureDb = new Proxy(db, {
            get(target, property) {
                if (property === '$transaction') return (operation: (tx: unknown) => unknown, options: { timeout?: number } | undefined) => {
                    erasureTransactionBudget = options?.timeout;
                    return target.$transaction(async tx => {
                        await tx.$executeRaw`SELECT pg_sleep(5.2)`;
                        return operation(tx);
                    }, options);
                };
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const erasure = new UserErasureService(delayedErasureDb, storage as never);
        await erasure.erase(a.user.id);
        check(erasureTransactionBudget === 30_000, 'erasure uses a bounded budget for atomic cleanup across screening tables');
        check(await db.aiScreeningSession.count({ where: { profileId: a.user.id } }) === 0, 'erasure clears sessions and answers');
        check(await db.aiScreeningCall.count({ where: { subjectId: a.id, status: 'ERASED' } }) === 1, 'erasure clears private provider results but retains accounting');
        check(!objects.has(report.pdfKey!), 'private PDF removed');
        check(!objects.has('reports/legacy-fixture.pdf') && await db.aiScreeningEvaluationRevision.count({ where: { evaluationId: evaluation.id } }) === 0, 'erasure removes historic PDF and revision data');
        process.env.TARA_SCREENING_ENABLED = 'false';
        check((await sessions.draft(b.user, legacyJob.id) as any).id === legacy.id, 'paused rollout still resumes legacy started sessions');
        await assert.rejects(() => sessions.draft({ id: 'new', role: 'EMPLOYEE' } as any, job.id));
        checks++;
        console.log('Tara integration:', checks, 'checks passed;', calls.length, 'mock AI calls. No live API spend.');
    }
    finally {
        await db.$disconnect();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
