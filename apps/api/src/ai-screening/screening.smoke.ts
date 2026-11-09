import assert from 'node:assert/strict';
import { LEGACY_CONVERSATION } from './conversation.policy';
import { nextProbeTarget, combineScores, scoreScreening, rankScreening } from './screening.policy';
import { validateCandidate, validateEvaluation, validateFollowUp, type CandidatePayload, type EvaluationPayload, type PackagePayload } from './screening.schemas';
import { composePrompt } from './prompts/compose';
import { freezePromptRegistry } from './prompts/registry';
import { screeningPreparation } from './screening-preparation';
const pendingPreparation = { resumeId: 'cv', package: { status: 'READY' }, currentPlan: { id: 'plan', status: 'PENDING' }, resumeVersion: { screeningSource: { status: 'READY' } } };
assert.equal(screeningPreparation({ ...pendingPreparation, resumeId: null }).status, 'WAITING_CV');
assert.equal(screeningPreparation(pendingPreparation).status, 'PROCESSING');
assert.equal(screeningPreparation({ ...pendingPreparation, currentPlan: { id: 'plan', status: 'READY' } }).status, 'READY');
assert.equal(screeningPreparation({ ...pendingPreparation, package: { status: 'FAILED', error: 'TARA_CALL_UNCERTAIN' } }).reason, 'RECOVERY_REQUIRED');
assert.equal(screeningPreparation({ ...pendingPreparation, resumeVersion: { screeningSource: { status: 'FAILED', error: 'CV_UNREADABLE' } } }).reason, 'CV_UNREADABLE');
assert.equal(screeningPreparation({ ...pendingPreparation, package: { status: 'FAILED', error: 'INVALID_PROVIDER_OUTPUT' } }).reason, 'PREPARATION_FAILED');
import { projectScreeningCost } from './screening-cost';
const rubric: PackagePayload = { context: 'Layanan pelanggan', criteria: ['a', 'b', 'c'].map(id => ({ id, name: id, requirementRef: 'Melayani pelanggan', anchors: ['0', '1', '2', '3', '4'] })) };
const cv = 'Membantu tim menaikkan penjualan 20%.\nBelajar membuat laporan di organisasi kampus.';
const plan: CandidatePayload = { claims: [{ id: 'claim', criterionId: 'a', statement: 'Membantu tim menaikkan penjualan 20%.', quote: 'Membantu tim menaikkan penjualan 20%.', lineStart: 1, lineEnd: 1, question: 'Bagian apa yang kamu kerjakan sendiri saat membantu tim menaikkan penjualan?' }], limitations: [] };
assert.equal(validateCandidate(plan, rubric, cv).claims.length, 1);
assert.throws(() => validateCandidate({ ...plan, claims: [{ ...plan.claims[0], quote: 'Memimpin tim menaikkan penjualan 20%.' }] }, rubric, cv));
assert.equal(validateCandidate({ ...plan, claims: [{ ...plan.claims[0], lineStart: 2 }] }, rubric, cv).claims[0].lineStart, 1);
assert.equal(validateCandidate({ ...plan, claims: [{ ...plan.claims[0], quote: 'Membantu tim menaikkan penjualan 20%.', lineStart: 1, lineEnd: 1 }] }, rubric, cv.replace('tim menaikkan','tim\nmenaikkan')).claims[0].quote, 'Membantu tim\nmenaikkan penjualan 20%.');
assert.throws(() => validateCandidate({ ...plan, claims: Array.from({ length: 11 }, (_, i) => ({ ...plan.claims[0], id: 'x' + i })) }, rubric, cv));
assert.throws(() => validateFollowUp({ stop: false, question: 'Sesi 2: apakah kamu siap?' }));
assert.equal(validateFollowUp({ stop: true, question: null }).stop, true);
const answers = [{ id: 'q', claimId: 'claim', criterionId: 'a', answer: 'Saya membantu mencatat hasil tim.' }];
const valid: EvaluationPayload = { summary: 'Kandidat menjelaskan kontribusinya.', strengths: [], gaps: [], interviewQuestions: [], criteria: rubric.criteria.map(c => ({ criterionId: c.id, score: c.id === 'a' ? 2 : null, reason: 'Bukti terbatas.', evidence: c.id === 'a' ? [{ questionId: 'q', quote: answers[0].answer }] : [] })), claims: [{ claimId: 'claim', status: 'SUPPORTED', reason: 'Kontribusi dijelaskan.', evidence: [{ questionId: 'q', quote: answers[0].answer }], contradictions: [] }] };
validateEvaluation(valid, rubric, plan, answers);
assert.throws(() => validateEvaluation({ ...valid, criteria: valid.criteria.map(c => ({ ...c, score: 4 })) }, rubric, plan, answers));
assert.throws(() => validateEvaluation({ ...valid, summary: 'Kandidat pasti berbohong.' }, rubric, plan, answers));
assert.throws(() => validateEvaluation({ ...valid, claims: [{ ...valid.claims[0], status: 'CLARIFY', contradictions: [] }] }, rubric, plan, answers));
assert.equal(scoreScreening([{ score: 0 }, { score: 4 }]), 50);
assert.equal(scoreScreening([{ score: null }, { score: 4 }]), null);
assert.equal(combineScores(82, 75), 78.5);
const roots = Array.from({ length: 5 }, (_, i) => ({ id: 'r' + i, position: i, kind: 'CORE', claimId: 'cl' + i, criterionId: 'c', answer: 'Kontribusi nyata.', rootQuestionId: null as string | null, depth: 0, probeClosed: false }));
const questions: import('./screening.policy').ProbeQuestion[] = [...roots];
for (let i = 0; i < 10; i++) {
    const target = nextProbeTarget(questions, LEGACY_CONVERSATION)!;
    assert.ok(target);
    assert.equal(target.depth, i % 2 + 1);
    if (target.depth === 2)
        assert.equal(target.parent.depth, 1);
    questions.push({ ...target.root, id: 'p' + i, kind: 'FOLLOW_UP', position: 5 + i, depth: target.depth, rootQuestionId: target.root.id });
}
assert.equal(nextProbeTarget(questions, LEGACY_CONVERSATION), null);
assert.equal(nextProbeTarget(roots.map(q => ({ ...q, answer: '' }))), null);
for (const n of [50, 100, 200, 300, 400, 500, 750, 1000]) {
    const ranked = rankScreening(Array.from({ length: n }, (_, i) => ({ id: String(i), createdAt: new Date(i), packageId: 'v' + (i % 2), finalScore: Math.round((i % n) / n * 1000) / 10, status: 'READY' })));
    assert.equal(ranked.ranks.size, n);
}
const cost = projectScreeningCost([{ task: 'prepare', costUsd: .002, inputTokens: 13000, outputTokens: 1000, reasoningTokens: 0, cachedTokens: 0, status: 'COMPLETED' }, { task: 'evaluate', costUsd: .005, inputTokens: 10000, outputTokens: 3000, reasoningTokens: 1000, cachedTokens: 0, status: 'COMPLETED' }], 1, 1);
assert.equal(cost.scenarios.length, 8);
assert.equal(cost.scenarios[0].totalUsd, .252);
assert.ok(cost.scenarios.every(s => s.targetMet));
for (const task of ['prepare', 'candidate', 'follow-up', 'evaluate'] as const) {
    const p = composePrompt(task, { marker: 'dynamic' });
    assert.equal(p.instructions.includes('dynamic'), false);
    assert.ok(p.input[0].content.includes('dynamic'));
    assert.equal(p.reasoning, task === 'evaluate' ? 'low' : 'none');
}
console.log('Tara policy, CV grounding, source validation, probe limits, modular prompts, 50–1,000 applicant ranking and cost arithmetic passed. AI judgement remains unvalidated.');
const frozen = freezePromptRegistry();
const pinned = composePrompt('follow-up', { newAnswer: 'UNIQUE_DYNAMIC_CANDIDATE_123' }, frozen['follow-up']);
assert.equal(pinned.instructions, frozen['follow-up'].instructions);
assert.equal(pinned.model, frozen['follow-up'].model);
assert.ok(!JSON.stringify(frozen).includes('UNIQUE_DYNAMIC_CANDIDATE_123'));
