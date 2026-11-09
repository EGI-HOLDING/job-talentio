import assert from 'node:assert/strict';
import { CURRENT_CONVERSATION as current, V4_CONVERSATION as v4, LEGACY_CONVERSATION as legacy, conversationPolicy, conversationTone, repeatsQuestion } from './conversation.policy';
import { answerDeadline, nextProbeTarget, type ProbeQuestion } from './screening.policy';
import { assertSchema, conversationSchemas, validateCandidate, validateFollowUp, validQuestion, type CandidatePayload, type PackagePayload } from './screening.schemas';
import { composePrompt } from './prompts/compose';
import { judgementScore, resolveEvidence, JUDGED_CLAIM_PROVIDER_SCHEMA } from './evidence-catalog';

for (const [level, base] of [['NONE', 0], ['GENERAL', 1], ['PARTIAL', 2], ['CONCRETE', 3]] as const)
    for (const detail of ['NONE', 'REASON', 'RESULT', 'BOUNDARY'])
        assert.equal(judgementScore(level, detail), level === 'CONCRETE' && detail !== 'NONE' ? 4 : base);
assert.throws(() => judgementScore('UNKNOWN', 'NONE'));
const judgementFixture = { claims: [{ claimId: 'x', status: 'SUPPORTED', judgement: { level: 'CONCRETE', detail: 'BOUNDARY', detailRef: 'a' }, evidence: [{ questionId: 'q', quoteRef: 'a' }], contradictions: [] }] };
assert.equal(resolveEvidence(judgementFixture, [{ id: 'a', source: 'ANSWER', ref: 'q', text: 'Persetujuan ada pada koordinator.' }]).claims[0].score, 4);
assert.throws(() => resolveEvidence(judgementFixture, [{ id: 'a', source: 'CV', ref: 'q', text: 'Persetujuan ada pada koordinator.' }]));
assert.throws(() => resolveEvidence(judgementFixture, []));
assert.ok(JUDGED_CLAIM_PROVIDER_SCHEMA.properties!.claims.items!.required!.includes('judgement'));
assert.ok(!JUDGED_CLAIM_PROVIDER_SCHEMA.properties!.claims.items!.properties!.score);

assert.equal(conversationTone([{ answer: 'Saya kurang nyaman bercanda.' }]), 'direct');
assert.equal(conversationTone([{ answer: 'Mohon lebih serius.' }]), 'direct');
assert.equal(conversationTone([{ answer: 'Saya mengerjakan tugas tersebut.' }]), 'playful');
assert.ok(repeatsQuestion('Pas ngecek keterbacaan harga, lu mulai dari bagian mana dulu?', ['Lu ngecek keterbacaan harga itu biasanya dari bagian mana dulu? wkwk']));
assert.equal(repeatsQuestion('Kenapa lu memilih urutan itu?', ['Bagaimana lu menjalankan urutan itu?']), false);
assert.equal(conversationPolicy(null), legacy);
assert.deepEqual(conversationPolicy(JSON.parse(JSON.stringify(current))), current);
assert.equal(conversationPolicy({ ...v4, version: 'tara-conversation-v4.0.0' }).version, 'tara-conversation-v4.0.0');
assert.throws(() => conversationPolicy({ ...current, questionSeconds: 1 }));
assert.equal(+answerDeadline(new Date(0), current), 60000);
assert.equal(+answerDeadline(new Date(0), legacy), 60000);
const rubric: PackagePayload = { context: 'Layanan', criteria: [{ id: 'a', name: 'Kontribusi', requirementRef: 'Layanan', anchors: ['0', '1', '2', '3', '4'] }] };
const cv = 'Membantu tim menangani pelanggan.';
const claim = { id: 'x', criterionId: 'a', statement: cv, quote: cv, lineStart: 1, lineEnd: 1, question: 'Spill dong, bagian layanan yang lu pegang waktu itu apa?' };
const schemas = conversationSchemas(current);
for (const count of [1, 2, 3, 4, 5]) {
    const plan: CandidatePayload = { claims: Array.from({ length: count }, (_, i) => ({ ...claim, id: 'x' + i })), limitations: [] };
    if (count <= current.maxCore) { validateCandidate(plan, rubric, cv, current); assertSchema(schemas.candidate, plan); }
    else { assert.throws(() => validateCandidate(plan, rubric, cv, current)); assert.throws(() => assertSchema(schemas.candidate, plan)); }
    validateCandidate(plan, rubric, cv, legacy);
}
for (const question of [claim.question, 'Di proyek itu lu pegang bagian apa 👀?', 'Bagian mana yang lu ubah sendiri?']) {
    assert.ok(validQuestion(question, current));
    assertSchema(schemas.followUp, { stop: false, question });
    validateFollowUp({ stop: false, question }, current);
}
for (const question of ['Tara: bagian apa yang lu kerjain?', 'Ceritain\nbagian lu?', '- Bagian apa yang lu kerjain?', 'Lu pegang apa 👀 😂?', 'kata '.repeat(36) + '?', 'a'.repeat(281)]) {
    assert.equal(validQuestion(question, current), false, question);
    assert.throws(() => validateFollowUp({ stop: false, question }, current));
}
assert.throws(() => assertSchema(schemas.followUp, { stop: false, question: 'Tara: bagian lu apa?' }));
assert.throws(() => assertSchema(schemas.followUp, { stop: false, question: 'kata '.repeat(36) + '?' }));
validateFollowUp({ stop: false, question: 'Pada pengalaman itu: bagian apa yang kamu tangani?' }, legacy);

// Exhaust all blank/answered root combinations and both scheduling policies.
let combinations = 0;
for (const policy of [current, legacy]) for (const count of [1, 2, 3]) for (let mask = 0; mask < 1 << count; mask++) {
    const roots: ProbeQuestion[] = Array.from({ length: count }, (_, i) => ({ id: 'r' + i, position: i, kind: 'CORE', claimId: 'c' + i, criterionId: 'a', answer: mask & 1 << i ? 'Kontribusi nyata.' : '', rootQuestionId: null, depth: 0, probeClosed: false }));
    const questions = [...roots], order: number[] = [];
    for (let n = 0; n < 11; n++) {
        const target = nextProbeTarget(questions, policy);
        if (!target) break;
        assert.equal(target.depth, target.parent.depth + 1);
        if (policy.probeOrder === 'breadth-first' && target.depth === 2)
            assert.ok(roots.filter(r => r.answer).every(r => questions.some(q => q.rootQuestionId === r.id)));
        order.push(target.root.position);
        questions.push({ ...target.root, id: 'p' + n, kind: 'FOLLOW_UP', position: questions.length, rootQuestionId: target.root.id, depth: target.depth });
    }
    assert.equal(order.length, Math.min(policy.maxFollowUp, roots.filter(r => r.answer).length * 2));
    if (count === 3 && mask === 7) assert.deepEqual(order, policy === current ? [0, 1, 2, 0, 1, 2] : [0, 0, 1, 1, 2, 2]);
    assert.equal(nextProbeTarget(questions, policy), null);
    combinations++;
}
const root: ProbeQuestion = { id: 'r', position: 0, kind: 'CORE', claimId: 'c', criterionId: 'a', answer: 'Cerita saya.', rootQuestionId: null, depth: 0, probeClosed: false };
assert.equal(nextProbeTarget([{ ...root, answer: null }]), null);
assert.equal(nextProbeTarget([{ ...root, probeClosed: true }]), null);
assert.equal(nextProbeTarget([root, { ...root, id: 'p', position: 1, kind: 'FOLLOW_UP', rootQuestionId: root.id, depth: 1, answer: '' }]), null);
for (const task of ['candidate', 'follow-up'] as const) {
    const prompt = composePrompt(task, {});
    assert.equal(prompt.version, current.version);
    assert.match(prompt.instructions, /gue\/lu/);
    assert.match(prompt.instructions, /35 kata dan 280 karakter/);
}
const assessment = composePrompt('evaluate', {});
assert.equal(assessment.version, 'tara-cv-claims-v3.0.3');
assert.equal(composePrompt('evaluate', {}, undefined, legacy).version, 'tara-cv-claims-v3.0.0');
assert.ok(!composePrompt('evaluate', {}, undefined, legacy).instructions.includes('Urutan keputusan tetap'));
assert.ok(!assessment.instructions.includes('Ngobrol pakai gue/lu'));
console.log('Conversation policy: schema limits, 30/60-second deadlines, legacy compatibility, ' + combinations + ' probe matrices, message format and prompt separation passed.');

assert.equal(+answerDeadline(new Date(0), v4), 30000);
assert.throws(() => conversationPolicy({ ...v4, questionSeconds: 60 }));
const opened = validateCandidate({ claims: [claim], limitations: [] }, rubric, cv, current);
assert.match(opened.claims[0].question, /^Oke, kita mulai ya 😄 /);
assert.deepEqual(validateCandidate(opened, rubric, cv, current), opened);
for (const question of ['', 'Oke, kita mulai ya 😄', 'Gue lihat ada proyek di CV lu.'])
    assert.throws(() => validateCandidate({ claims: [{ ...claim, question }], limitations: [] }, rubric, cv, current));
assert.equal(validateCandidate({ claims: [claim], limitations: [] }, rubric, cv, v4).claims[0].question, claim.question);
assert.throws(() => validateCandidate({ claims: [{ ...claim, question: 'Eh bentar, bagian mana yang lu pegang?' }], limitations: [] }, rubric, cv, current));
assert.throws(() => validateCandidate({ claims: [{ ...claim, question: 'Bagian apa yang lu kerjakan 👀?' }], limitations: [] }, rubric, cv, current));
assert.throws(() => validateCandidate({ claims: [{ ...claim, question: 'kata '.repeat(32) + 'apa?' }], limitations: [] }, rubric, cv, current));
console.log('Opening stored once; historical snapshots retained; v6 allows 10 + 15 at 60 seconds.');
