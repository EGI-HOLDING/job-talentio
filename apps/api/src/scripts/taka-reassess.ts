import 'reflect-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { inspectTakaReassessment, queueTakaReassessment } from '../ai-screening/taka-reassessment';
import { ROLE_ASSESSMENT_VERSION } from '../ai-screening/role-rubric';
import { TARA_LIVE_AUDIO_PROTOCOL } from '@job-talentio/shared';

async function main() {
    const [mode, sessionId, expected] = process.argv.slice(2);
    if (!((mode === 'inventory' && !sessionId) || (['dry-run', 'apply'].includes(mode) &&
        /^c[a-z0-9]{15,40}$/u.test(sessionId ?? '') && (mode === 'dry-run' ? !expected : Boolean(expected)))))
        throw Error('Use inventory, dry-run SESSION_ID, or apply SESSION_ID EXPECTED_KEY');
    const db = new PrismaService();
    try {
        if (mode === 'apply') {
            const work = await db.$transaction(tx => queueTakaReassessment(tx, sessionId, expected));
            if (!work) throw Error('Session did not match the dry run or no longer has eligible evidence');
            console.log(JSON.stringify({ sessionId, workId: work.id, status: work.status }));
            return;
        }
        const report = await db.$transaction(async tx => {
            await tx.$executeRaw`SET TRANSACTION READ ONLY`;
            if (mode === 'dry-run') return inspectTakaReassessment(tx, sessionId);
            let cursor: string | undefined, checked = 0;
            const affected = [];
            while (true) {
                const page = await tx.aiScreeningEvaluation.findMany({ where: { status: 'NEEDS_REVIEW', promptVersion: ROLE_ASSESSMENT_VERSION,
                    session: { voice: { promptVersion: TARA_LIVE_AUDIO_PROTOCOL, status: 'ENDED' } } }, select: { id: true, sessionId: true },
                    orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: 50 });
                if (!page.length) break;
                checked += page.length;
                const calls = await tx.aiScreeningCall.findMany({ where: { subjectId: { in: page.map(row => row.sessionId) }, task: 'evaluate',
                    promptVersion: ROLE_ASSESSMENT_VERSION, status: 'COMPLETED' }, select: { subjectId: true, result: true } });
                const suspect = new Set(calls.filter(call => Object.entries((call.result as { criteria?: Record<string, { questionRef?: string }> } | null)?.criteria ?? {})
                    .some(([id, row]) => row?.questionRef === id)).map(call => call.subjectId));
                for (const id of suspect) {
                    const row = await inspectTakaReassessment(tx, id);
                    if (row?.badReferences) affected.push({ sessionId: id, badReferences: row.badReferences });
                }
                cursor = page.at(-1)!.id;
            }
            return { checked, affected };
        }, { timeout: 60_000, isolationLevel: 'RepeatableRead' });
        if (!report) throw Error('No eligible evaluation found for this session');
        console.log(JSON.stringify(report));
    } finally {
        await db.$disconnect();
    }
}

void main().catch(error => { console.error(error.message); process.exitCode = 1; });
