import { PrismaClient, type Prisma } from '@prisma/client';
import { frozenRoleRubric, roleCvCriteria, type RoleRubric } from '../ai-screening/role-rubric';
import { json } from '../ai-screening/screening.policy';
import { reprojectStoredCvScore } from '../ai-screening/recruitment/cv-assessment';

type CandidateScore = {
    id: string;
    revision: number;
    cvScore: number;
    cvResult: Prisma.JsonObject & { criteria?: Array<{ criterionId: string }> };
    jobSnapshot: Prisma.JsonObject & { resolvedRoleRubric?: RoleRubric };
};

export async function reprojectCvLanguageScores(db: PrismaClient, apply: boolean) {
    const stats = { checked: 0, eligible: 0, changed: 0, concurrent: 0, unverified: 0, withoutRemainingCriteria: 0 };
    let cursor = '';
    for (;;) {
        const candidates = await db.$queryRaw<CandidateScore[]>`SELECT id, revision, "cvScore", "cvResult", "jobSnapshot"
            FROM "RecruitmentCandidate" WHERE "scoreStatus" = 'READY' AND "cvScore" IS NOT NULL
            AND "cvResult" ? 'roleAssessment' AND "jobSnapshot" IS NOT NULL AND id > ${cursor} ORDER BY id LIMIT 100`;
        if (!candidates.length) return stats;
        cursor = candidates[candidates.length - 1].id;
        for (const row of candidates) {
            stats.checked++;
            const rubric = row.jobSnapshot.resolvedRoleRubric ?? frozenRoleRubric(row.jobSnapshot);
            if (!rubric || !Array.isArray(rubric.criteria) || !Array.isArray(row.cvResult.criteria)) continue;
            const kept = new Set(roleCvCriteria(rubric).map(criterion => criterion.id));
            const excluded = new Set(rubric.criteria.filter(criterion => !kept.has(criterion.id)).map(criterion => criterion.id));
            if (!row.cvResult.criteria.some(grade => excluded.has(grade.criterionId))) continue;
            let projected;
            try { projected = reprojectStoredCvScore(row.cvResult, rubric, row.cvScore); }
            catch { stats.unverified++; continue; }
            if (!projected) { stats.unverified++; continue; }
            stats.eligible++;
            if (projected.score === null) stats.withoutRemainingCriteria++;
            if (!apply) continue;
            const updated = await db.recruitmentCandidate.updateMany({
                where: { id: row.id, revision: row.revision, scoreStatus: 'READY', cvScore: row.cvScore,
                    cvResult: { equals: json(row.cvResult) }, jobSnapshot: { equals: json(row.jobSnapshot) } },
                data: { cvScore: projected.score, cvResult: json(projected.cvResult), revision: { increment: 1 } },
            });
            stats.changed += updated.count;
            stats.concurrent += 1 - updated.count;
        }
    }
}

if (require.main === module) {
    const mode = process.argv[2] ?? 'dry-run';
    if (!['dry-run', 'apply'].includes(mode)) throw Error('Expected dry-run or apply');
    if (mode === 'apply' && (process.env.TARA_SCREENING_MARKET !== 'id' || process.env.TAKA_ROLE_ASSESSMENT_ENABLED !== 'true')) {
        throw Error('Expected the Indonesia role-assessment deployment');
    }
    const db = new PrismaClient();
    reprojectCvLanguageScores(db, mode === 'apply')
        .then(stats => console.log(JSON.stringify({ mode, ...stats })))
        .catch(error => { console.error(error.name); process.exitCode = 1; })
        .finally(() => db.$disconnect());
}
