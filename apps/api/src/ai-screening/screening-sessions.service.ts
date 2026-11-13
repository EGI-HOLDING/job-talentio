import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CompaniesService } from '../companies/companies.service';
import type { AuthUser } from '../common/auth.decorators';
import { registerCvVersion } from '../profiles/cv-evidence';
import { freezeHrSubmission } from '../matching/recruiter-evidence';
import { enqueueWork, ScreeningPackets } from './screening-packets.service';
import { answerDeadline, isExpired, json, MAX_ANSWER_CHARS, SESSION_LEASE_MS, screeningEnabled } from './screening.policy';
import type { CandidatePayload, PackagePayload } from './screening.schemas';
import { ScreeningCandidatePlans } from './screening-candidate-plans.service';
import { screeningPreparation } from './screening-preparation';
import { newConversationPolicy, conversationPolicy, publicConversationPolicy, requireCurrentConversation, isCurrentConversation } from './conversation.policy';
import { advanceTara, recordTaraOpportunity, startTara, taraTopics, TARA_CHAT_REVIEW_MS, TARA_COMPLETE_MS, TARA_FIRST_PASS_MS,
    TARA_ROLE_INTRO, TARA_SESSION_MS, type TaraDecision, type TaraProgress } from './tara-interview';
import { frozenRoleRubric } from './role-rubric';
const sessionInclude = { invitation: { include: { candidate: { select: { stage:true, company: { select: { isBanned: true, anonymizedAt: true } } } } } }, package: true, currentPlan: true, questions: { orderBy: { position: 'asc' as const } }, resumeVersion: { include: { screeningSource: true } }, evaluation: true, job: { include: { company: { select: { name: true } }, city: { select: { name: true } } } } } satisfies Prisma.AiScreeningSessionInclude;
type Session = Prisma.AiScreeningSessionGetPayload<{
    include: typeof sessionInclude;
}>;
type Upload = {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
};
export function validateScreeningFile(file: Upload) {
    if (!file)
        throw new BadRequestException('Pilih berkas terlebih dahulu.');
    const pdf = /\.pdf$/i.test(file.originalname) && file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-';
    const docx = /\.docx$/i.test(file.originalname) && file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
    if (file.size > 5 * 1024 * 1024 || !file.buffer.length || (!pdf && !docx))
        throw new BadRequestException('Gunakan PDF atau DOCX yang valid, maksimal 5 MB.');
}
@Injectable()
export class ScreeningSessions {
    constructor(private db: PrismaService, private storage: StorageService, private companies: CompaniesService, private packets: ScreeningPackets, private config: ConfigService, private plans: ScreeningCandidatePlans) { }
    private async profile(user: AuthUser) {
        if (!['EMPLOYEE', 'SUPER_ADMIN'].includes(user.role))
            throw new ForbiddenException();
        const profile = await this.db.employeeProfile.findUnique({ where: { userId: user.id }, include: { user: { select: { isBanned: true, anonymizedAt: true } } } });
        if (profile?.user.isBanned || profile?.user.anonymizedAt)
            throw new ForbiddenException();
        if (!profile)
            throw new BadRequestException('Lengkapi profil kandidat terlebih dahulu.');
        return profile;
    }
    async owned(user: AuthUser, id: string): Promise<Session> {
        const profile = await this.profile(user);
        const row = await this.db.aiScreeningSession.findFirst({ where: { id, profileId: profile.id }, include: sessionInclude });
        if (!row)
            throw new NotFoundException('Draf lamaran tidak ditemukan.');
        if (row.invitation && (row.invitation.status === 'CANCELLED' || row.invitation.candidate.company.isBanned || row.invitation.candidate.company.anonymizedAt)) throw new ForbiddenException('Undangan tidak lagi tersedia.');
        if(row.invitation&&!row.startedAt&&['HIRED','REJECTED','WITHDRAWN'].includes(row.invitation.candidate.stage))throw new ForbiddenException('Proses rekrutmen sudah ditutup. Undangan ini tidak dapat dimulai.');
        if (row.invitation && !row.startedAt && row.invitation.expiresAt <= new Date()) throw new ConflictException('Undangan sudah kedaluwarsa.');
        return row;
    }
    private async public(row: Session) {
        const active = row.questions.find(q => q.answer === null);
        const preparation = screeningPreparation(row);
        const requiresRecovery = /UNCERTAIN|REQUIRES_REVIEW|UNCONFIRMED|RETRY_LIMIT/.test([row.error, row.package?.error, row.currentPlan?.error].join(' ')) ||
            Boolean((preparation.status === 'FAILED' || row.error) && await this.db.aiScreeningWork.count({ where: {
                subjectId: { in: [row.id, row.packageId, row.currentPlanId, row.resumeVersionId].filter((v): v is string => Boolean(v)) }, status: 'FAILED', attempts: { gte: 3 },
            } }));
        if (preparation.status === 'FAILED' && requiresRecovery && preparation.reason !== 'CV_UNREADABLE') preparation.reason = 'RECOVERY_REQUIRED';
        const cv = row.cvSnapshot as {
            resume?: {
                id: string;
                title: string;
            };
        } | null;
        return { id: row.id, invitation: row.invitation ? { id: row.invitation.id, mode: row.invitation.mode, status: row.invitation.status } : null, status: row.status, startedAt: row.startedAt, completedAt: row.completedAt, applicationId: row.applicationId,
            resumeId: row.resumeId, cv: cv?.resume ? { id: cv.resume.id, title: cv.resume.title, parseStatus: row.resumeVersion?.parseStatus } : null,
            coverLetter: row.coverLetter ?? '', coverFilename: row.coverFilename, source: row.source, revision: row.revision, serverTime: new Date().toISOString(),
            ...(row.taraDeadlineAt ? {interviewDeadlineAt:row.taraDeadlineAt} : {}),
            packetReady: preparation.status === 'READY',
            preparationStatus: row.currentPlan?.status ?? 'WAITING_CV',
            preparation,
            conversationPolicy: publicConversationPolicy(row.startedAt && row.package ? conversationPolicy(row.package.conversationPolicy) : newConversationPolicy()),
            recoveryRequired: requiresRecovery,
            job: { id: row.job.id, title: row.job.title, companyName: row.job.isAnonymous ? 'Perusahaan dirahasiakan' : row.job.company.name, city: row.job.city?.name ?? '' },
            questions: row.questions.filter(q => !active || q.position <= active.position).map(q => ({ id: q.id, text: q.text, draft: q.draft, answer: q.answer, shownAt: q.shownAt, deadlineAt: q.deadlineAt, answeredAt: q.answeredAt, timedOut: q.timedOut })),
            error: preparation.reason === 'CV_UNREADABLE' ? 'CV belum bisa dibaca. Gunakan PDF atau DOCX dengan teks yang jelas.' : row.error || preparation.status === 'FAILED' ? 'Tara sedang mengalami kendala. Progresmu aman, coba lanjutkan sebentar lagi.' : null };
    }
    async draft(user: AuthUser, jobId: string) {
        const [profile] = await Promise.all([this.profile(user), this.packets.available(jobId)]);
        const application = await this.db.application.findUnique({ where: { jobPostId_profileId: { jobPostId: jobId, profileId: profile.id } }, select: { id: true } });
        if (application)
            return { applicationId: application.id, status: 'SUBMITTED', jobId };
        if (!screeningEnabled()) {
            const existing = await this.db.aiScreeningSession.findUnique({ where: { legacyKey: 'legacy:' + jobId + ':' + profile.id }, include: sessionInclude });
            if (!existing?.startedAt)
                throw new NotFoundException('Screening baru sedang dijeda.');
            return this.public(existing);
        }
        const row = await this.db.$transaction(async (tx) => {
            await tx.$queryRaw(Prisma.sql `SELECT id FROM "EmployeeProfile" WHERE id=${profile.id} FOR UPDATE`);
            const account = await tx.user.findUnique({ where: { id: user.id }, select: { isBanned: true, anonymizedAt: true } });
            if (!account || account.isBanned || account.anonymizedAt)
                throw new ForbiddenException();
            return tx.aiScreeningSession.upsert({ where: { legacyKey: 'legacy:' + jobId + ':' + profile.id }, create: { jobId, profileId: profile.id, legacyKey: 'legacy:' + jobId + ':' + profile.id }, update: {}, include: sessionInclude });
        });
        if (row.status === 'DRAFT' && row.resumeId) {
            await this.plans.request(row.id);
            return this.state(user, row.id);
        }
        void this.packets.sync(jobId).catch(() => undefined);
        return this.public(row);
    }
    async completeInvited(user: AuthUser, id: string) {
        const row = await this.owned(user, id);
        if (!row.invitation || row.invitation.mode !== 'TEXT') throw new ForbiddenException();
        if (row.status !== 'COMPLETED') throw new ConflictException('Selesaikan interview terlebih dahulu.');
        await this.db.$transaction(async tx => {
            await tx.screeningInvitation.update({where:{id:row.invitation!.id},data:{status:'COMPLETED'}});
            await tx.aiScreeningEvaluation.upsert({where:{sessionId:id},create:{sessionId:id,promptVersion:row.currentPlan?.promptVersion??'pending'},update:{}});
            await enqueueWork(tx,'EVALUATE',id);
        });
        return this.state(user,id);
    }
    async state(user: AuthUser, id: string) {
        let row = await this.owned(user, id);
        if (row.status === 'DRAFT' && row.resumeId && !isCurrentConversation(row.package?.conversationPolicy)) {
            await this.plans.request(id);
            row = await this.owned(user, id);
        }
        if (row.taraDeadlineAt && ['ACTIVE','GENERATING'].includes(row.status) &&
            (+row.taraDeadlineAt - (TARA_SESSION_MS - TARA_COMPLETE_MS) <= Date.now() || row.taraAdvanceAt && +row.taraAdvanceAt <= Date.now())) {
            if (await this.advanceTimedChat(id, new Date(), row.revision)) return this.public(await this.owned(user, id));
        }
        return this.public(row);
    }
    async save(user: AuthUser, id: string, data: {
        resumeId?: string;
        coverLetter?: string;
        removeCoverFile?: boolean;
        source?: string;
        funnelSession?: string;
    }) {
        const row = await this.owned(user, id);
        if (row.invitation) throw new ForbiddenException('CV screening ditentukan oleh undangan HR.');
        if (row.status !== 'DRAFT')
            throw new ConflictException('Dokumen sudah dikunci setelah screening dimulai.');
        if (data.resumeId) {
            const cv = await this.db.resume.findFirst({ where: { id: data.resumeId, profileId: row.profileId, ...(row.invitation ? {} : {deletedAt: null}), fileKey: { not: null } } });
            if (!cv)
                throw new BadRequestException('CV tidak tersedia.');
        }
        const result = await this.db.aiScreeningSession.updateMany({ where: { id, status: 'DRAFT' }, data: { ...(data.resumeId ? { resumeId: data.resumeId } : {}),
                ...(data.coverLetter !== undefined ? { coverLetter: data.coverLetter } : {}), ...(data.source ? { source: data.source.toLowerCase() } : {}),
                ...(data.funnelSession ? { funnelSession: data.funnelSession } : {}), ...(data.removeCoverFile ? { coverFileKey: null, coverFilename: null, coverContentType: null } : {}), revision: { increment: 1 } } });
        if (!result.count)
            throw new ConflictException('Screening sudah dimulai.');
        if (data.removeCoverFile && row.coverFileKey)
            await this.storage.delete(row.coverFileKey).catch(() => undefined);
        if (data.resumeId)
            await this.plans.request(id);
        return this.state(user, id);
    }
    async uploadCover(user: AuthUser, id: string, file: Upload) {
        validateScreeningFile(file);
        const row = await this.owned(user, id);
        if (row.status !== 'DRAFT')
            throw new ConflictException('Dokumen sudah dikunci.');
        const stored = await this.storage.upload(file.buffer, file.originalname, file.mimetype, 'screening/covers/' + row.profileId);
        const changed = await this.db.aiScreeningSession.updateMany({ where: { id, status: 'DRAFT' }, data: { coverFileKey: stored.key, coverFilename: file.originalname, coverContentType: file.mimetype, revision: { increment: 1 } } });
        if (!changed.count) {
            await this.storage.delete(stored.key).catch(() => undefined);
            throw new ConflictException('Screening sudah dimulai.');
        }
        if (row.coverFileKey)
            await this.storage.delete(row.coverFileKey).catch(() => undefined);
        return this.state(user, id);
    }
    async coverUrl(user: AuthUser, id: string) {
        const row = await this.owned(user, id);
        if (!row.coverFileKey)
            throw new NotFoundException();
        return { url: await this.storage.getPresignedGetUrl(row.coverFileKey, 300, { filename: row.coverFilename ?? 'cover-letter.pdf', contentType: row.coverContentType ?? 'application/pdf' }) };
    }
    async claim(user: AuthUser, id: string, clientId: string) {
        const row = await this.owned(user, id), now = new Date();
        const updated = await this.db.aiScreeningSession.updateMany({ where: { id, profileId: row.profileId, OR: [{ leaseToken: null }, { leaseToken: clientId }, { leaseExpiresAt: { lte: now } }] }, data: { leaseToken: clientId, leaseExpiresAt: new Date(+now + SESSION_LEASE_MS) } });
        if (!updated.count)
            throw new ConflictException('Screening sedang terbuka di tab lain. Lanjutkan di tab tersebut atau tutup tab itu sebentar.');
        return this.state(user, id);
    }
    private async lock(tx: Prisma.TransactionClient, id: string, profileId: string, clientId?: string) {
        await tx.$queryRaw(Prisma.sql `SELECT id FROM "AiScreeningSession" WHERE id=${id} FOR UPDATE`);
        const row = await tx.aiScreeningSession.findUniqueOrThrow({ where: { id }, include: { package: { select: { conversationPolicy: true } }, questions: { orderBy: { position: 'asc' } } } });
        if (row.profileId !== profileId)
            throw new NotFoundException();
        if (clientId && (row.leaseToken !== clientId || !row.leaseExpiresAt || row.leaseExpiresAt <= new Date()))
            throw new ConflictException('Tab ini perlu tersambung kembali sebelum mengirim jawaban.');
        return row;
    }
    async start(user: AuthUser, id: string, clientId: string, transport: 'TEXT' | 'VOICE' = 'TEXT') {
        const row = await this.owned(user, id);
        if (row.invitation && row.invitation.mode !== transport) throw new ForbiddenException('Gunakan jenis interview sesuai undangan.');
        if (row.status !== 'DRAFT')
            return this.claim(user, id, clientId);
        if (!screeningEnabled())
            throw new ServiceUnavailableException('Screening baru sedang dijeda.');
        await this.packets.available(row.jobId, Boolean(row.invitation));
        // Validate ownership, lease and CV even when preparation is still pending.
        await this.db.$transaction(async tx => {
            const current = await this.lock(tx, id, row.profileId, clientId);
            const resume = await tx.resume.findFirst({ where: { id: current.resumeId ?? '', profileId: row.profileId, ...(row.invitation ? {} : {deletedAt: null}), fileKey: { not: null } } });
            if (!resume) throw new BadRequestException('Pilih CV sebelum mulai, ya.');
        });
        const plan = await this.plans.request(id);
        const fresh = await this.owned(user, id);
        const preparation = screeningPreparation(fresh);
        if (preparation.status === 'FAILED')
            throw new ServiceUnavailableException('Tara sedang mengalami kendala. Progresmu aman; periksa status persiapan untuk melanjutkan.');
        if (!plan || plan.status !== 'READY' || preparation.status !== 'READY')
            return this.public(fresh);
        const payload = plan.payload as unknown as CandidatePayload;
        await this.db.$transaction(async (tx) => {
            if (row.invitation) {
                await tx.$queryRaw(Prisma.sql`SELECT id FROM "ScreeningInvitation" WHERE id=${row.invitation.id} FOR UPDATE`);
                await tx.$queryRaw(Prisma.sql`SELECT id FROM "RecruitmentCandidate" WHERE id=${row.invitation.candidateId} FOR UPDATE`);
                const invite=await tx.screeningInvitation.findUniqueOrThrow({where:{id:row.invitation.id},include:{candidate:{select:{stage:true}}}});if(['HIRED','REJECTED','WITHDRAWN'].includes(invite.candidate.stage))throw new ConflictException('Proses rekrutmen sudah ditutup.');
                if(invite.status==='CANCELLED'||invite.expiresAt<=new Date())throw new ConflictException('Undangan tidak lagi aktif.');
            }
            await tx.$queryRaw(Prisma.sql `SELECT id FROM "EmployeeProfile" WHERE id=${row.profileId} FOR UPDATE`);
            const session = await this.lock(tx, id, row.profileId, clientId);
            if (session.status !== 'DRAFT')
                return;
            const resume = await tx.resume.findFirst({ where: { id: session.resumeId ?? '', profileId: row.profileId, ...(row.invitation ? {} : {deletedAt: null}), fileKey: { not: null } } });
            if (!resume?.fileKey)
                throw new BadRequestException('Pilih CV sebelum mulai, ya.');
            if (session.currentPlanId !== plan.id)
                throw new ConflictException('Pilihan CV berubah. Muat ulang sebelum mulai.');
            const version = await tx.resumeVersion.findUniqueOrThrow({ where: { id: plan.resumeVersionId }, include: { employeeEvidence: true } });
            if (version.fileKey !== resume.fileKey)
                throw new ConflictException('CV berubah. Pilih ulang CV sebelum mulai.');
            const profile = await tx.employeeProfile.findUniqueOrThrow({ where: { id: row.profileId }, include: { languages: { include: { language: true } }, certifications: true } });
            requireCurrentConversation(session.package?.conversationPolicy);
            const topics = transport === 'TEXT'
                ? taraTopics(payload, fresh.package?.payload as unknown as PackagePayload, true) : null;
            const now = new Date(), snapshot = { resume: { id: resume.id, title: resume.title, fileKey: version.fileKey }, submission: freezeHrSubmission(version, profile, now) };
            await tx.aiScreeningSession.update({ where: { id }, data: { packageId: plan.packageId, resumeVersionId: version.id, cvSnapshot: json(snapshot), status: 'ACTIVE', startedAt: now, error: null, leaseToken: clientId, leaseExpiresAt: new Date(+now + SESSION_LEASE_MS), revision: { increment: 1 }, ...(topics ? { taraInterview: json(startTara(topics, true)) } : {}) } });
            if (row.invitation) await tx.screeningInvitation.update({ where: { id: row.invitation.id }, data: { status: 'STARTED' } });
            const startingQuestions = topics?.slice(0, 1) ?? [];
            const introduction = frozenRoleRubric(fresh.package?.jobSnapshot) ? TARA_ROLE_INTRO + '\n\n' : '';
            if (startingQuestions.length) await tx.aiScreeningQuestion.createMany({ data: startingQuestions.map((c, position) => ({ sessionId: id, position, criterionId: c.criterionId, claimId: c.id, kind: 'CORE', depth: 0, text: introduction + c.question })) });
        });
        return this.state(user, id);
    }
    async shown(user: AuthUser, id: string, clientId: string, questionId: string) {
        const owner = await this.owned(user, id);
        if (owner.invitation?.mode === 'VOICE') throw new ForbiddenException('Interview suara menggunakan transkrip langsung.');
        await this.db.$transaction(async (tx) => {
            const session = await this.lock(tx, id, owner.profileId, clientId);
            const q = session.questions.find(q => q.answer === null);
            if (!q || q.id !== questionId || session.status !== 'ACTIVE')
                throw new ConflictException('Pertanyaan sudah berganti.');
            if (!q.shownAt) {
                const now = new Date();
                const policy = requireCurrentConversation(session.package?.conversationPolicy);
                const deadline = session.taraDeadlineAt ?? new Date(+now + TARA_SESSION_MS);
                const closeAt = +deadline - (TARA_SESSION_MS - TARA_COMPLETE_MS);
                if (+now >= closeAt) return;
                if (!session.taraDeadlineAt) await tx.aiScreeningSession.update({where:{id},data:{taraDeadlineAt:deadline}});
                const deadlineAt = new Date(Math.min(+answerDeadline(now, policy), closeAt));
                await tx.aiScreeningQuestion.update({ where: { id: q.id }, data: { shownAt: now, deadlineAt } });
            }
        });
        return this.state(user, id);
    }
    async answer(user: AuthUser, id: string, clientId: string, questionId: string, answer: string, submit: boolean) {
        if (answer.length > MAX_ANSWER_CHARS)
            throw new BadRequestException('Jawab ringkas, maksimal 1.200 karakter ya.');
        const owner = await this.owned(user, id);
        if (owner.invitation?.mode === 'VOICE') throw new ForbiddenException('Jawaban interview suara direkam melalui sesi suara.');
        await this.recordAnswer(id, owner.profileId, questionId, answer, submit, clientId);
        return this.state(user, id);
    }
    private async recordAnswer(id: string, profileId: string, questionId: string, answer: string, submit: boolean, clientId?: string) {
        const timed = await this.db.$transaction(async (tx) => {
            const session = await this.lock(tx, id, profileId, clientId);
            const q = session.questions.find(q => q.id === questionId);
            if (!q || q.answer !== null)
                return;
            const current = session.questions.find(q => q.answer === null);
            if (current?.id !== questionId || !q.shownAt || session.status !== 'ACTIVE')
                throw new ConflictException('Pertanyaan belum aktif.');
            requireCurrentConversation(session.package?.conversationPolicy);
            const expired = isExpired(q.deadlineAt);
            if (!submit && !expired) {
                await tx.aiScreeningQuestion.update({ where: { id: q.id }, data: { draft: answer } });
                await tx.aiScreeningSession.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() + SESSION_LEASE_MS) } });
                return;
            }
            // Requests arriving after the deadline cannot replace the last server-saved draft.
            const now = new Date();
            await tx.aiScreeningQuestion.update({ where: { id: q.id }, data: { draft: expired ? q.draft : answer, answer: (expired ? q.draft : answer).trim(), answeredAt: now, timedOut: expired } });
            const next = session.questions.find(v => v.position > q.position && v.answer === null), revision = session.revision + 1;
            const advanceAt = session.taraDeadlineAt && !next ? new Date(+now + TARA_CHAT_REVIEW_MS) : null;
            const tara = advanceAt ? session.taraInterview as unknown as TaraProgress | null : null;
            if (tara && q.deadlineAt) {
                const topic = tara.topics[tara.active];
                if (topic?.note.topicId === q.claimId) recordTaraOpportunity(topic.note, {
                    questionRef: q.id, openedAt: +q.shownAt, closedAt: expired ? +q.deadlineAt : +now, delivery: 'CHAT',
                    redirected: topic.focus === 'OFF_TOPIC',
                    connected: Boolean(session.leaseExpiresAt && +session.leaseExpiresAt >= (expired ? +q.deadlineAt : +now)),
                    resolution: !expired ? 'ANSWERED' : +q.deadlineAt - +q.shownAt >= 60_000 ? 'WINDOW_EXPIRED' : 'CUT_SHORT',
                });
            }
            await tx.aiScreeningSession.update({ where: { id }, data: { status: next ? 'ACTIVE' : 'GENERATING', revision, error: null, leaseExpiresAt: new Date(+now + SESSION_LEASE_MS), ...(advanceAt ? {taraAdvanceAt:advanceAt} : {}), ...(tara ? {taraInterview:json(tara)} : {}) } });
            if (!next)
                await enqueueWork(tx, 'ADVANCE', id, 'ADVANCE:' + id + ':' + revision);
            if (advanceAt) return {advanceAt, revision};
        });
        if (timed) {
            const timer = setTimeout(() => void this.advanceTimedChat(id, new Date(), timed.revision).catch(() => undefined), Math.max(0, +timed.advanceAt - Date.now()));
            timer.unref();
        }
    }
    async expireAnswers() {
        const now = new Date();
        const due = await this.db.aiScreeningSession.findMany({where:{
            OR:[{status:'GENERATING',taraAdvanceAt:{lte:now}},
                {status:{in:['ACTIVE','GENERATING']},taraDeadlineAt:{lte:new Date(+now + TARA_SESSION_MS - TARA_COMPLETE_MS)}}],
        },select:{id:true,revision:true},take:50});
        for (const row of due) await this.advanceTimedChat(row.id, now, row.revision).catch(() => undefined);
        const questions = await this.db.aiScreeningQuestion.findMany({ where: { answer: null, deadlineAt: { lte: new Date() }, session: { status: 'ACTIVE' } }, include: { session: { select: { profileId: true } } }, take: 50 });
        for (const q of questions)
            await this.recordAnswer(q.sessionId, q.session.profileId, q.id, q.draft, true).catch(() => undefined);
    }
    async advanceTimedChat(id: string, now: Date, revision: number, decision?: TaraDecision) {
        return this.db.$transaction(async tx => {
            const invitation = await tx.screeningInvitation.findUnique({where:{sessionId:id},select:{id:true}});
            if (invitation) await tx.$queryRaw(Prisma.sql`SELECT id FROM "ScreeningInvitation" WHERE id=${invitation.id} FOR UPDATE`);
            await tx.$queryRaw(Prisma.sql`SELECT id FROM "AiScreeningSession" WHERE id=${id} FOR UPDATE`);
            const row = await tx.aiScreeningSession.findUnique({where:{id},include:sessionInclude});
            if (!row?.taraDeadlineAt || row.revision !== revision || !['ACTIVE','GENERATING'].includes(row.status) ||
                row.invitation?.status === 'CANCELLED' || !isCurrentConversation(row.package?.conversationPolicy)) return false;
            const start = +row.taraDeadlineAt - TARA_SESSION_MS, closeAt = start + TARA_COMPLETE_MS;
            const closing = +now >= closeAt;
            if (!closing && (row.status !== 'GENERATING' || !row.taraAdvanceAt || !decision && +now < +row.taraAdvanceAt)) return false;
            if (row.taraAdvanceAt && +now >= +row.taraAdvanceAt) decision = undefined;
            const topics = taraTopics(row.currentPlan!.payload as unknown as CandidatePayload, row.package!.payload as unknown as PackagePayload, true);
            const progress = row.taraInterview as unknown as TaraProgress;
            const last = row.questions.at(-1)!;
            const previous = row.questions.filter(q => q.claimId === topics[progress.active].id);
            const answer = last.answer ?? (last.shownAt ? last.draft.trim() : '');
            if (last.answer === null && last.shownAt) await tx.aiScreeningQuestion.update({where:{id:last.id},data:{answer,answeredAt:now,timedOut:true}});
            const remaining = Math.max(0, topics.length - progress.active - 1);
            const window = 60_000 + TARA_CHAT_REVIEW_MS;
            const next = advanceTara(progress, topics, {
                questionRef:last.shownAt ? last.id : undefined, answerRefs:answer ? [last.id] : [], answered:!!answer,
                previous:previous.map(q=>q.text), decision, timedOut:closing || last.timedOut,
                answers:answer ? [{ref:last.id,text:answer}] : [],
                opportunity:last.shownAt && !progress.topics[progress.active].note.opportunities?.some(item=>item.questionRef===last.id)
                    ? {questionRef:last.id,openedAt:+last.shownAt,closedAt:+(last.answeredAt ?? now),delivery:'CHAT',
                        ...(last.answer === null ? {resolution:'CUT_SHORT' as const} : {}),
                        redirected:progress.topics[progress.active].focus === 'OFF_TOPIC'} : undefined,
            }, {
                canContinue: !closing,
                canClarify:+now + window <= Math.min(closeAt, start + TARA_FIRST_PASS_MS - remaining * window),
                canRevisit:+now + window <= closeAt,
            });
            await tx.aiScreeningSession.update({where:{id},data:{
                taraInterview:json(next.progress),taraAdvanceAt:null,revision:{increment:1},error:null,
                ...(next.question ? {status:'ACTIVE'} : {status:'COMPLETED',completedAt:now}),
            }});
            if (!next.question) {
                if (invitation) {
                    await tx.screeningInvitation.update({where:{id:invitation.id},data:{status:'COMPLETED'}});
                    await tx.aiScreeningEvaluation.upsert({where:{sessionId:id},create:{sessionId:id,promptVersion:row.currentPlan!.promptVersion},update:{}});
                    await enqueueWork(tx,'EVALUATE',id);
                }
                return true;
            }
            const active = topics[next.progress.active], depth = next.progress.topics[next.progress.active].depth;
            const root = row.questions.find(q=>q.claimId === active.id && q.kind === 'CORE');
            const parent = row.questions.filter(q=>q.claimId === active.id).at(-1);
            await tx.aiScreeningQuestion.create({data:{sessionId:id,position:row.questions.length,claimId:active.id,criterionId:active.criterionId,
                kind:depth ? 'FOLLOW_UP' : 'CORE',rootQuestionId:depth ? root?.id : null,parentQuestionId:depth ? parent?.id : null,depth,text:next.question}});
            return true;
        });
    }
    async retry(user: AuthUser, id: string) {
        const row = await this.owned(user, id);
        if (row.status === 'DRAFT')
            await this.plans.request(id);
        const fresh = await this.owned(user, id);
        const subjects = [id, fresh.packageId, fresh.currentPlanId, fresh.resumeVersionId].filter((v): v is string => Boolean(v));
        const works = await this.db.aiScreeningWork.findMany({ where: { subjectId: { in: subjects }, status: 'FAILED' } });
        for (const work of works) {
            const uncertain = await this.db.aiScreeningCall.count({ where: { workId: work.id, status: { in: ['UNCERTAIN', 'ERASED'] } } });
            if (uncertain || work.attempts >= 3)
                throw new ServiceUnavailableException('Tara sedang memulihkan percakapanmu. Progres aman; tim kami perlu memeriksa sambungannya.');
            await this.db.$transaction(async tx => {
                const changed = await tx.aiScreeningWork.updateMany({ where: { id: work.id, status: 'FAILED' }, data: { status: 'PENDING', availableAt: new Date(), error: null } });
                if (!changed.count) return;
                if (work.kind === 'PREPARE') await tx.aiScreeningPackage.updateMany({ where: { id: work.subjectId, status: 'FAILED' }, data: { status: 'PENDING', error: null } });
                if (work.kind === 'CANDIDATE') await tx.aiCandidatePlan.updateMany({ where: { id: work.subjectId, status: 'FAILED' }, data: { status: 'PENDING', error: null } });
                if (work.kind === 'CV_SOURCE') await tx.aiCvSource.updateMany({ where: { versionId: work.subjectId, status: 'FAILED' }, data: { status: 'PENDING', error: null } });
                if (work.kind === 'ADVANCE') await tx.aiScreeningSession.updateMany({ where: { id }, data: { error: null } });
            });
        }
        return this.state(user, id);
    }
    async companyDocument(user: AuthUser, companyId: string) {
        await this.companies.assertMember(user, companyId);
        const row = await this.db.aiCompanyDocument.findFirst({ where: { companyId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, filename: true, status: true, createdAt: true } });
        return { enabled: screeningEnabled(), document: row };
    }
    async uploadCompany(user: AuthUser, companyId: string, file: Upload) {
        if (!screeningEnabled())
            throw new NotFoundException();
        validateScreeningFile(file);
        await this.companies.assertMember(user, companyId, ['OWNER', 'ADMIN']);
        const { createHash } = await import('node:crypto');
        const stored = await this.storage.upload(file.buffer, file.originalname, file.mimetype, 'screening/company/' + companyId);
        await this.db.$transaction(async (tx) => {
            const document = await tx.aiCompanyDocument.create({ data: { companyId, fileKey: stored.key, filename: file.originalname, contentType: file.mimetype, checksum: createHash('sha256').update(file.buffer).digest('hex') } });
            await enqueueWork(tx, 'DOCUMENT', document.id);
        });
        return this.companyDocument(user, companyId);
    }
}
