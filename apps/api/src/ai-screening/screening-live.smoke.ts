// Explicit opt-in only. Synthetic source documents; existing key is never printed.
import 'reflect-metadata';
import fs from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ScreeningClient, AiPending } from './screening.client';
import { validatePackage, validateCandidate, validateFollowUp, validateEvaluation, type CandidatePayload, type PackagePayload } from './screening.schemas';
import { projectScreeningCost } from './screening-cost';
import { evidenceCatalog, resolveEvidence } from './evidence-catalog';
import { validateClaimEvaluation } from './claim-assessment';
async function main() {
    if (process.env.TARA_RUN_LIVE !== 'true')
        throw Error('Explicit live benchmark opt-in required');
    const dbUrl = new URL(process.env.DATABASE_URL!);
    if (dbUrl.hostname !== '127.0.0.1' || !/^\/talentio_tara_it_\d+$/.test(dbUrl.pathname))
        throw Error('Disposable DB required');
    const keys = ['.env', 'apps/api/.env'].map(p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').match(/^OPENAI_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') : undefined).filter((key): key is string => Boolean(key));
    let key: string | undefined;
    const report: Record<string, unknown> = { model: 'gpt-6-luna', synthetic: true, live: true, completed: 0, notes: ['Document sizes are approximate fixture token counts; provider usage is authoritative.', 'One sample does not validate assessment quality or establish production cost.'] };
    fs.mkdirSync('output/tara-cost', { recursive: true });
    const db = new PrismaService();
    try {
        if (!keys.length)
            throw Error('OPENAI_API_KEY_ABSENT');
        let failure = 'MODEL_NOT_AVAILABLE';
        for (const candidate of [...new Set(keys)]) {
            const available = await fetch('https://api.openai.com/v1/models/gpt-6-luna', { headers: { Authorization: 'Bearer ' + candidate }, signal: AbortSignal.timeout(20000) });
            if (available.ok) {
                key = candidate;
                break;
            }
            const body = await available.json() as any;
            failure = 'MODEL_PREFLIGHT_HTTP_' + available.status + '_' + String(body.error?.code ?? 'unknown');
        }
        if (!key)
            throw Error(failure);
        const client = new ScreeningClient(db, new ConfigService({ OPENAI_API_KEY: key }));
        async function run(task: Parameters<ScreeningClient['run']>[2], input: unknown, index = 0) {
            const work = 'live-' + task + '-' + index;
            for (let poll = 0; poll < 90; poll++) {
                try {
                    return await client.run(work, 'synthetic-live-candidate', task, input);
                }
                catch (e) {
                    if (!(e instanceof AiPending))
                        throw e;
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            throw Error('LIVE_RESPONSE_PENDING_OPERATOR_REVIEW');
        }
        // Deliberately long source documents model the user's extreme input scenario.
        const repeat = (text: string, size: number) => Array.from({ length: size }, (_, i) => text + ' ' + i).join('\n');
        const job = { title: 'Customer Service', description: 'Menangani layanan pelanggan, mencatat proses, mengukur hasil dan bekerja bersama tim.\n' + repeat('Tanggung jawab: mendengarkan keluhan, menelusuri pesanan, mencatat tindak lanjut dan melaporkan hasil pelayanan.', 100) };
        const company = { name: 'PT Synthetic Test', profile: repeat('Perusahaan melayani pelanggan melalui telepon, pesan dan email. Tim bekerja sama mencatat keluhan dan memperbaiki layanan sesuai prosedur.', 330) };
        const cvText = ['Membantu tim meningkatkan penjualan sebesar 20%.', 'Membantu menangani 100 pertanyaan pelanggan setiap hari.', 'Membuat catatan tindak lanjut layanan pelanggan.', 'Menggunakan spreadsheet untuk memantau waktu tanggapan.', 'Berkolaborasi dengan tim operasional untuk menyelesaikan keluhan.', repeat('Pengalaman pendukung: mencatat permintaan pelanggan, menyusun daftar tindak lanjut, memantau hasil dan berkoordinasi dengan rekan satu tim.', 200)].join('\n');
        const rubric = validatePackage(await run('prepare', { job, company }));
        const plan = validateCandidate(await run('candidate', { job: rubric, cvLines: cvText.split('\n').map((text, i) => ({ line: i + 1, text })) }), rubric, cvText);
        const answers: any[] = plan.claims.map((c, i) => ({ id: 'q' + i, claimId: c.id, criterionId: c.criterionId, rootQuestionId: null, parentQuestionId: null, depth: 0, kind: 'CORE', shownAt: new Date(0), answeredAt: new Date(60000), question: c.question, answer: 'Saya mencatat pelanggan yang perlu dihubungi, menghubungi mereka melalui pesan, lalu mencatat respons dan hasilnya di spreadsheet tim.' }));
        for (const root of [...answers])
            for (let depth = 1; depth <= 2; depth++) {
                const chain = answers.filter(a => a.id === root.id || a.rootQuestionId === root.id), claim = plan.claims.find(c => c.id === root.claimId)!;
                const follow = validateFollowUp(await run('follow-up', { context: rubric.context, criterion: rubric.criteria.find(c => c.id === claim.criterionId), claim, targetDepth: depth, rootQuestionId: root.id, chain }, answers.length));
                if (follow.stop)
                    break;
                answers.push({ id: 'q' + answers.length, claimId: claim.id, criterionId: claim.criterionId, rootQuestionId: root.id, parentQuestionId: chain.at(-1).id, depth, kind: 'FOLLOW_UP', shownAt: new Date(0), answeredAt: new Date(60000), question: follow.question, answer: depth === 1 ? 'Saya memprioritaskan pesanan yang paling lama menunggu, lalu meminta persetujuan supervisor untuk tindak lanjut yang memerlukan keputusan.' : 'Saya membandingkan catatan minggu ini dengan minggu sebelumnya; hasil keseluruhan adalah hasil tim, sedangkan kontribusi saya hanya pencatatan dan tindak lanjut.' });
            }
        const catalog = evidenceCatalog(plan,answers);
        validateClaimEvaluation(resolveEvidence(await run('evaluate', { context: rubric.context, claims: plan.claims, limitations: plan.limitations, answers, evidenceCatalog: catalog }),catalog),rubric,plan,answers);
        report.completed = 1;
        report.status = 'SAMPLE_COMPLETED';
        report.questions = answers.length;
        report.fixtureCharacters = { cv: cvText.length, company: JSON.stringify(company).length, job: JSON.stringify(job).length };
    }
    catch (error) {
        report.status = 'BLOCKED';
        report.error = error instanceof Error ? error.message : 'LIVE_FAILED';
    }
    finally {
        let calls = await db.aiScreeningCall.findMany({ where: { subjectId: 'synthetic-live-candidate' }, select: { id: true, task: true, status: true, responseId: true, inputTokens: true, outputTokens: true, reasoningTokens: true, cachedTokens: true, costUsd: true, error: true } });
        // Preserve provider IDs in the local report and cancel unfinished benchmark work
        // before the disposable database is removed. An incomplete call is never reported
        // as a successful zero-cost lifecycle.
        for (const call of calls.filter(c => c.status === 'RUNNING' && c.responseId)) {
            if (!key)
                continue;
            try {
                const cancelled = await fetch('https://api.openai.com/v1/responses/' + call.responseId + '/cancel', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20000) });
                report.cleanupStatus = cancelled.ok ? 'CANCELLATION_REQUESTED' : 'OPERATOR_REVIEW_REQUIRED';
            }
            catch {
                report.cleanupStatus = 'OPERATOR_REVIEW_REQUIRED';
            }
        }
        report.accountingComplete = Number(report.completed) > 0 && calls.every(c => c.status === 'COMPLETED');
        report.calls = calls;
        report.cost = projectScreeningCost(calls, Number(report.completed), calls.some(c => c.task === 'candidate') ? 1 : 0);
        fs.writeFileSync('output/tara-cost/live-sample.json', JSON.stringify(report, null, 2));
        await db.$disconnect();
        console.log(JSON.stringify(report, null, 2));
    }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
