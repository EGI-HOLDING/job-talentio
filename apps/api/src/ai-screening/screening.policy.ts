import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
export const SCREENING_PROMPT_VERSION = 'tara-cv-claims-v2.0.0';
export const SCREENING_RANKING_VERSION = 'tara-cv-claims-composite-v2';
export const PDF_TEMPLATE_VERSION = 'tara-report-v1';
export const QUESTION_SECONDS = 60;
export const MAX_CORE = 5;
export const MAX_FOLLOW_UP = 10;
export const MAX_PROBES_PER_ROOT = 2;
export const MAX_ANSWER_CHARS = 1200;
export const SESSION_LEASE_MS = 20000;
export const WORK_LEASE_MS = 90000;
export const screeningEnabled = () => process.env.TARA_SCREENING_ENABLED === 'true' && process.env.TARA_SCREENING_MARKET === 'id';
export const screeningModel = () => process.env.TARA_SCREENING_MODEL?.trim() || 'gpt-6-luna';
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export function normalizedText(value: unknown) { return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim() : ''; }
export function redactIdentity(value: unknown): string {
    return JSON.stringify(value).replace(/\S+@\S+\.\S+/g, '[email]').replace(/\+?\d[\d ()\t.-]{7,}\d/g, '[contact]');
}
export function scoreScreening(rows: Array<{
    score: number | null;
}>): number | null {
    return rows.length && rows.every(r => r.score !== null) ? Math.round(rows.reduce((s, r) => s + r.score!, 0) / rows.length / 4 * 1000) / 10 : null;
}
export function combineScores(cv: number | null, screening: number | null): number | null {
    return cv !== null && screening !== null && Number.isFinite(cv) && Number.isFinite(screening) ? Math.round((cv + screening) * 5) / 10 : null;
}
export function answerDeadline(shownAt: Date) { return new Date(shownAt.getTime() + QUESTION_SECONDS * 1000); }
export function isExpired(deadline: Date | null, now = new Date()) { return Boolean(deadline && deadline <= now); }
export function canProbe(questions: Array<{
    kind: string;
    rootQuestionId?: string | null;
}>, rootId: string) {
    return questions.filter(q => q.kind === 'FOLLOW_UP').length < MAX_FOLLOW_UP &&
        questions.filter(q => q.kind === 'FOLLOW_UP' && q.rootQuestionId === rootId).length < MAX_PROBES_PER_ROOT;
}
export type RankedScreening = {
    id: string;
    createdAt: Date;
    packageId: string | null;
    finalScore: number | null;
    status: string;
};
export type ProbeQuestion = {
    id: string;
    position: number;
    kind: string;
    claimId: string;
    criterionId: string;
    answer: string | null;
    rootQuestionId: string | null;
    depth: number;
    probeClosed: boolean;
};
export function nextProbeTarget(questions: ProbeQuestion[]) {
    if (questions.filter(q => q.kind === 'FOLLOW_UP').length >= MAX_FOLLOW_UP)
        return null;
    for (const root of questions.filter(q => q.kind === 'CORE').sort((a, b) => a.position - b.position)) {
        if (root.probeClosed || !root.answer?.trim())
            continue;
        const children = questions.filter(q => q.rootQuestionId === root.id).sort((a, b) => a.depth - b.depth);
        if (children.length >= MAX_PROBES_PER_ROOT)
            continue;
        const parent = children.at(-1) ?? root;
        if (!parent.answer?.trim())
            continue;
        return { root, parent, depth: children.length + 1 };
    }
    return null;
}
export function rankScreening<T extends RankedScreening>(items: T[]) {
    const sorted = [...items].sort((a, b) => (a.packageId ?? '~').localeCompare(b.packageId ?? '~') || (b.finalScore ?? -1) - (a.finalScore ?? -1) || +a.createdAt - +b.createdAt || a.id.localeCompare(b.id));
    const ranks = new Map<string, number>();
    let group = '', previous: number | null = null, rank = 0, index = 0;
    for (const row of sorted) {
        if ((row.packageId ?? 'legacy') !== group) {
            group = row.packageId ?? 'legacy';
            previous = null;
            index = 0;
        }
        if (row.finalScore === null || row.status !== 'READY')
            continue;
        index++;
        if (previous !== row.finalScore)
            rank = index;
        ranks.set(row.id, rank);
        previous = row.finalScore;
    }
    return { sorted, ranks };
}
