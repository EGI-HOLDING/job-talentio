import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { StorageService } from '../storage/storage.service';
import type { AuthUser } from '../common/auth.decorators';
import type { RecruiterBreakdown } from '../matching/recruiter-matching';
import { conversationPolicy, assessmentVersion } from './conversation.policy';
import { rankScreening, SCREENING_PROMPT_VERSION, SCREENING_RANKING_VERSION, hash } from './screening.policy';
export type TaraSummary = {
    methodology: string;
    assessedClaims: number;
    scoreReason: string | null;
    status: string;
    packageId: string | null;
    version: number | null;
    cvScore: number | null;
    screeningScore: number | null;
    finalScore: number | null;
    rank: number | null;
    pdfReady: boolean;
    summary: string | null;
};
export type TaraBaseWindow = {
    ids: string[];
    scores: Map<string, RecruiterBreakdown>;
    total: number;
    page: number;
    totalPages: number;
};
export type TaraWindowExtra = {
    tara: Map<string, TaraSummary>;
    taraGroups: Array<{
        id: string;
        version: number | null;
        count: number;
        methodology: string;
    }>;
};
@Injectable()
export class ScreeningHr {
    private tables?: Promise<boolean>;
    constructor(private db: PrismaService, private companies: CompaniesService, private storage: StorageService) { }
    private ready() {
        return this.tables ??= this.db.$queryRaw<Array<{
            name: string | null;
        }>> `SELECT to_regclass('public."AiScreeningSession"')::text AS name`.then(r => Boolean(r[0]?.name)).catch(() => false);
    }
    async hasForJob(jobId: string) { return await this.ready() && Boolean(await this.db.aiScreeningSession.count({ where: { jobId, applicationId: { not: null } } })); }
    async project<T extends TaraBaseWindow>(base: T, opts: {
        sort?: string;
        minMatch?: number;
        page?: number;
        limit?: number;
        screeningVersion?: string;
    }): Promise<T & TaraWindowExtra> {
        const rows = await this.db.application.findMany({ where: { id: { in: base.ids } }, select: { id: true, createdAt: true, screeningSession: { select: { packageId: true, package: { select: { version: true } }, evaluation: true } } } });
        const info = new Map<string, TaraSummary>();
        for (const row of rows) {
            const s = row.screeningSession, e = s?.evaluation;
            const result = e?.result as { claims?: unknown[] } | null;
            info.set(row.id, { methodology: e?.promptVersion ?? 'legacy', assessedClaims: result?.claims?.length ?? 0,
                scoreReason: e?.result && e.screeningScore !== null && e.cvScore === null ? 'CV_SCORE_UNAVAILABLE' : e?.status === 'FAILED' ? 'EVALUATION_FAILED' : e?.result && e.screeningScore === null ? 'LEGACY_INSUFFICIENT_EVIDENCE' : null,
                status: s ? (e?.status ?? 'PENDING') : 'LEGACY', packageId: s?.packageId ?? null, version: s?.package?.version ?? null,
                cvScore: e?.cvScore ?? (base.scores.get(row.id)?.assessable ? base.scores.get(row.id)!.total : null), screeningScore: e?.screeningScore ?? null, finalScore: e?.finalScore ?? null, rank: null, pdfReady: Boolean(e?.pdfKey),
                summary: (e?.result as {
                    summary?: string;
                } | null)?.summary ?? null });
            if (e?.cvBreakdown)
                base.scores.set(row.id, e.cvBreakdown as unknown as RecruiterBreakdown);
        }
        const groups = new Map<string, {
            id: string;
            version: number | null;
            count: number;
            methodology: string;
        }>();
        for (const s of info.values()) {
            const id = s.packageId ? s.packageId + ':' + s.methodology : 'legacy';
            const g = groups.get(id) ?? { id, version: s.version, count: 0, methodology: s.methodology };
            g.count++;
            groups.set(id, g);
        }
        let chosen = rows.filter(r => !opts.screeningVersion || opts.screeningVersion === 'all' || (info.get(r.id)!.packageId ?? 'legacy') === opts.screeningVersion || (info.get(r.id)!.packageId + ':' + info.get(r.id)!.methodology) === opts.screeningVersion);
        if (opts.minMatch !== undefined)
            chosen = chosen.filter(r => { const score = opts.sort === 'cv' ? info.get(r.id)!.cvScore : info.get(r.id)!.finalScore; return score !== null && score >= opts.minMatch!; });
        const rank = rankScreening(chosen.map(r => ({ id: r.id, createdAt: r.createdAt, methodology: info.get(r.id)!.methodology, packageId: info.get(r.id)!.packageId, finalScore: info.get(r.id)!.finalScore, status: info.get(r.id)!.status })));
        for (const [id, n] of rank.ranks)
            info.get(id)!.rank = n;
        chosen.sort((a, b) => {
            const x = info.get(a.id)!, y = info.get(b.id)!;
            if (opts.sort === 'newest')
                return +b.createdAt - +a.createdAt || a.id.localeCompare(b.id);
            if (opts.sort === 'cv')
                return (y.cvScore ?? -1) - (x.cvScore ?? -1) || +a.createdAt - +b.createdAt || a.id.localeCompare(b.id);
            return (y.version ?? -1) - (x.version ?? -1) || x.methodology.localeCompare(y.methodology) || (y.finalScore ?? -1) - (x.finalScore ?? -1) || +a.createdAt - +b.createdAt || a.id.localeCompare(b.id);
        });
        const limit = opts.limit ?? 10, total = chosen.length, totalPages = Math.max(1, Math.ceil(total / limit)), page = Math.min(opts.page ?? 1, totalPages);
        const ids = (opts.page ? chosen.slice((page - 1) * limit, page * limit) : chosen).map(r => r.id);
        return { ...base, ids, total, page, totalPages, rankingVersion: SCREENING_RANKING_VERSION, rankingRevision: hash([...info]), rankingAvailable: true,
            tara: info, taraGroups: [...groups.values()].sort((a, b) => (b.version ?? -1) - (a.version ?? -1)) };
    }
    private async access(user: AuthUser, applicationId: string) {
        if (!['RECRUITER', 'SUPER_ADMIN'].includes(user.role))
            throw new ForbiddenException();
        const row = await this.db.application.findUnique({ where: { id: applicationId }, select: { jobPost: { select: { companyId: true } }, screeningSession: { include: { package: true, currentPlan: true, evaluation: true, questions: { orderBy: { position: 'asc' } } } } } });
        if (!row)
            throw new NotFoundException();
        await this.companies.assertMember(user, row.jobPost.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
        if (!row.screeningSession)
            throw new NotFoundException('Lamaran ini dikirim sebelum screening Tara.');
        return row.screeningSession;
    }
    async assessment(user: AuthUser, id: string) {
        const s = await this.access(user, id), e = s.evaluation;
        const reevaluation = await this.db.aiScreeningWork.findUnique({ where: { key: 'EVALUATE:' + s.id + ':' + assessmentVersion(conversationPolicy(s.package?.conversationPolicy)) }, select: { status: true } });
        const revisions = e ? await this.db.aiScreeningEvaluationRevision.findMany({ where: { evaluationId: e.id }, select: { id: true, promptVersion: true, createdAt: true }, orderBy: { createdAt: 'desc' } }) : [];
        return { status: e?.status ?? 'PENDING', cvScore: e?.cvScore ?? null, screeningScore: e?.screeningScore ?? null, finalScore: e?.finalScore ?? null, result: e?.result ?? null,
            methodology: e?.promptVersion ?? null, reevaluationStatus: reevaluation?.status ?? null, assessedClaims: (e?.result as { claims?: unknown[] } | null)?.claims?.length ?? 0,
            scoreReason: e?.result && e.screeningScore !== null && e.cvScore === null ? 'CV_SCORE_UNAVAILABLE' : e?.status === 'FAILED' ? 'EVALUATION_FAILED' : e?.result && e.screeningScore === null ? 'LEGACY_INSUFFICIENT_EVIDENCE' : null, revisions,
            version: s.package?.version, promptVersion: e?.promptVersion, pdfReady: Boolean(e?.pdfKey), coverFilename: s.coverFilename,
            rubric: s.package?.payload, plan: s.currentPlan?.payload, questions: s.questions.map(q => ({ id: q.id, question: q.text, answer: q.answer, timedOut: q.timedOut })) };
    }
    async revision(user: AuthUser, id: string, revisionId: string) {
        const session = await this.access(user, id);
        if (!session.evaluation) throw new NotFoundException();
        const revision = await this.db.aiScreeningEvaluationRevision.findFirst({ where: { id: revisionId, evaluationId: session.evaluation.id } });
        if (!revision) throw new NotFoundException();
        const snapshot = revision.snapshot as { status: string; cvScore: number | null; screeningScore: number | null; finalScore: number | null; result: unknown; pdfKey?: string };
        return { id: revision.id, createdAt: revision.createdAt, methodology: revision.promptVersion, status: snapshot.status, cvScore: snapshot.cvScore,
            screeningScore: snapshot.screeningScore, finalScore: snapshot.finalScore, result: snapshot.result,
            pdfUrl: snapshot.pdfKey ? await this.storage.getPresignedGetUrl(snapshot.pdfKey, 300, { filename: 'laporan-screening-tara-riwayat.pdf', contentType: 'application/pdf' }) : null };
    }
    async pdf(user: AuthUser, id: string) {
        const s = await this.access(user, id);
        if (!s.evaluation?.pdfKey)
            throw new ConflictException('Laporan sedang disiapkan. Coba lagi sebentar.');
        return { url: await this.storage.getPresignedGetUrl(s.evaluation.pdfKey, 300, { filename: 'laporan-screening-tara.pdf', contentType: 'application/pdf' }) };
    }
    async cover(user: AuthUser, id: string) {
        const s = await this.access(user, id);
        if (!s.coverFileKey)
            throw new NotFoundException();
        return { url: await this.storage.getPresignedGetUrl(s.coverFileKey, 300, { filename: s.coverFilename ?? 'cover-letter.pdf', contentType: s.coverContentType ?? 'application/pdf' }) };
    }
}
