import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { composePrompt } from './prompts/compose';
import { CV_EXTRACTION_VERSION, createRoleRubric } from './role-rubric';
import { completeCvSource, CV_RESPONSE_FORMAT, cvRequest, decodeCvResponse, mergeCvGrades, projectCvScore,
    type CvCheckpoint } from './recruitment/cv-assessment';
import { prepareCvDocument } from './recruitment/cv-document';
import { CvProvider, cvTerminal, cvUsage, isCvResponseId, type CvHttp, type CvResponse } from './recruitment/cv-provider';
import { hash } from './screening.policy';
import { acceptRoleJudgements, freezeRoleAssessment, prepareRoleEvidence, roleEvaluationRequest,
    scoreRoleAssessment, type RoleTranscriptEntry } from './taka-role-assessment';

type Case = { id: string; role: string; responsibilities: string[]; pdf: string; pdfChecksum: string;
    interview: Array<{ question: string; answer: string; opportunity: 'ANSWERED' }> };
const model = 'gpt-6-luna';
const terminal = (state: string | undefined) => ['completed', 'incomplete', 'failed', 'cancelled'].includes(state ?? '');

async function main() {
    assert.equal(process.env.TAKA_PAID_SYNTHETIC_GATE, '1', 'Explicit paid synthetic test opt-in required');
    const [manifestPath, predictionPath, runId] = process.argv.slice(2);
    assert.match(runId, /^[a-z0-9-]+$/u);
    const dir = dirname(resolve(manifestPath));
    assert.equal(resolve(predictionPath), join(dir, `predictions-${runId}.json`));
    const { checksum, ...manifest } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { checksum: string; cases: Case[] };
    assert.equal(hash(manifest), checksum);
    assert.equal(manifest.cases.length, 30);
    assert.equal(new Set(manifest.cases.map(row => row.role)).size, 6);
    const ledger = join(dir, 'spend.jsonl');
    const history = existsSync(ledger) ? readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean)
        .map(row => JSON.parse(row) as { runId: string; key: string; reservedUsd?: number; costUsd?: number }) : [];
    assert.ok(history.every(row => row.runId !== runId), 'Run already has provider requests; inspect its receipts first');
    let reserved = history.reduce((sum, row) => sum + (row.reservedUsd ?? 0), 0), actual = 0, submissions = 0;
    const budget = 2.5;
    const note = (row: object) => appendFileSync(ledger, JSON.stringify({ runId, ...row }) + '\n');
    function reserve(key: string, reservedUsd: number) {
        assert.ok(reserved + reservedUsd <= budget, 'Scoring test allocation exhausted');
        reserved += reservedUsd;
        submissions++;
        note({ key, reservedUsd });
    }
    if (!process.env.OPENAI_API_KEY) process.loadEnvFile('.env');
    const provider = new CvProvider(new ConfigService());
    assert.ok(provider.configured);
    async function result(key: string, first: CvHttp): Promise<unknown> {
        const id = first.body?.id;
        assert.ok(isCvResponseId(id), key + ' create status ' + first.status + ' ' + (first.body?.error?.code ?? ''));
        note({ key, responseId: id });
        let response: CvResponse = first.body!;
        const until = Date.now() + 420_000;
        while (!terminal(response.status) && Date.now() < until) {
            await wait(3500);
            const observed = await provider.get(id);
            if (observed.status === 200 && observed.body?.id === id) response = observed.body;
        }
        assert.ok(terminal(response.status), key + ' still pending at provider');
        const usage = cvUsage(response, model);
        actual += usage.costUsd;
        note({ key, ...usage, status: response.status });
        try {
            const payload = cvTerminal(response);
            assert.equal(payload.error, undefined, key + ' ' + payload.error);
            return payload.result;
        } finally {
            await provider.delete(id);
        }
    }
    async function grade(sample: Case) {
        assert.match(sample.id, /^R[1-6]-[1-5]$/u);
        assert.equal(sample.pdf, 'cv/' + sample.id + '.pdf');
        const rubric = createRoleRubric({ title: sample.role, responsibilities: sample.responsibilities, jobSkills: [], jobLanguages: [] });
        const document = await prepareCvDocument(readFileSync(join(dir, sample.pdf)), 'synthetic-cv.pdf', 'synthetic-cv.pdf');
        assert.equal(document.checksum, sample.pdfChecksum);
        assert.equal(document.pages, 1);
        const checkpoint: CvCheckpoint = { stage: 'INITIAL', responseFormat: CV_RESPONSE_FORMAT, model, checksum: document.checksum,
            expectedPages: document.pages, fileKind: document.fileKind, grades: [], roleRubric: rubric, extractionVersion: CV_EXTRACTION_VERSION };
        const cvKey = sample.id + ':CV';
        reserve(cvKey, .016);
        const cvResponse = await result(cvKey, await provider.create(randomUUID(), model, cvRequest(checkpoint, { title: sample.role }), document.file));
        const decoded = decodeCvResponse(checkpoint, cvResponse as Parameters<typeof decodeCvResponse>[1]);
        assert.ok(completeCvSource(decoded.source, document.pages), sample.id + ' incomplete CV');
        const grades = mergeCvGrades(decoded.source!, [], decoded.grades, rubric);
        assert.equal(grades.length, rubric.criteria.length, sample.id + ' missing CV grades');
        const cv = projectCvScore(decoded.source!, grades, true, false, rubric);
        const transcript = sample.interview.flatMap<RoleTranscriptEntry>((turn, index) => {
            const topicId = rubric.interviewIds[index], at = index * 60_000;
            return [{ id: 'q' + index, topicId, speaker: 'TARA', text: turn.question,
                question: true, opportunity: turn.opportunity, startMs: at, endMs: at + 2000 },
            { id: 'a' + index, topicId, speaker: 'CANDIDATE', text: turn.answer, startMs: at + 3000, endMs: at + 16000 }];
        });
        const evidence = prepareRoleEvidence(rubric, transcript, { claims: [], limitations: [] });
        const { data, preset } = roleEvaluationRequest(evidence, freezeRoleAssessment());
        const prompt = composePrompt('evaluate', data, preset);
        const evalKey = sample.id + ':INTERVIEW';
        reserve(evalKey, .006);
        const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST',
            headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json', 'X-Client-Request-Id': randomUUID() },
            signal: AbortSignal.timeout(120_000), body: JSON.stringify({ model, background: true, store: true,
                reasoning: { effort: prompt.reasoning, context: 'current_turn' }, max_output_tokens: prompt.maxOutput,
                prompt_cache_options: { mode: 'explicit', ttl: '30m' },
                input: [{ role: 'developer', content: [{ type: 'input_text', text: prompt.instructions,
                    prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' } }] }, ...prompt.input],
                text: { format: { type: 'json_schema', name: prompt.name, strict: true, schema: prompt.schema } },
            }) });
        const judgement = await result(evalKey, { status: response.status, body: await response.json() as CvResponse });
        const scored = scoreRoleAssessment(evidence, acceptRoleJudgements(evidence, judgement), cv.score, false).result.roleAssessment!;
        return { id: sample.id, cv: grades.map(row => row.level), competency: scored.criteria.map(row => row.level),
            explanation: scored.criteria.map(row => row.clarity), total: scored.score };
    }
    const grades: Array<Awaited<ReturnType<typeof grade>>> = [], failures: Array<{ id: string; code: string }> = [];
    const persist = () => writeFileSync(predictionPath, JSON.stringify({ checksum, grades, failures, submissions, actualUsd: actual, reservedUsd: reserved }, null, 2));
    async function assess(sample: Case) {
        try {
            const scored = await grade(sample);
            assert.ok(scored.total !== null, sample.id + ' assessment incomplete');
            grades.push(scored);
        } catch (error) {
            failures.push({ id: sample.id, code: error instanceof Error ? error.message : 'UNKNOWN' });
        }
        persist();
    }
    const canaries = [manifest.cases[0], manifest.cases[4]];
    for (const sample of canaries) {
        await assess(sample);
        if (failures.length) throw new Error(JSON.stringify({ failures, submissions, actualUsd: actual, reservedUsd: reserved }));
    }
    const remaining = manifest.cases.filter(sample => !canaries.includes(sample));
    let next = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
        while (next < remaining.length) await assess(remaining[next++]);
    }));
    console.log(JSON.stringify({ completed: grades.length, failures, submissions, actualUsd: actual, reservedUsd: reserved }));
    assert.equal(failures.length, 0);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Synthetic scoring failed'); process.exitCode = 1; });
