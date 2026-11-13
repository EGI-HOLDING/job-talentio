import assert from 'node:assert/strict';
import { cvCriteria } from './recruitment/cv-assessment';
import { createVoiceRequest } from './prompts/voice-session';
import { createRoleRubric } from './role-rubric';
import { taraTopics } from './tara-interview';
import { attachLiveRoleTopics, liveAgendaRequest, liveAgendaRubric, liveRolePackage, prepareLiveAgenda } from './tara-live-agenda';
import type { Claim } from './screening.schemas';

const responsibilities = [
    'Siapkan demo teknis untuk pelanggan',
    'Persiapkan demonstrasi solusi untuk klien',
    'Rancang persiapan demo produk untuk prospek',
    'Susun proposal teknis sesuai kebutuhan klien',
    'Validasi konfigurasi pelanggan dengan uji beban',
    'Gali kebutuhan klien sebelum menawarkan solusi',
    'Catat jadwal rapat internal',
];
const rubric = createRoleRubric({ title: 'Presales Engineer', responsibilities, experienceYearsMin: 3,
    jobSkills: [], jobLanguages: [{ language: { name: 'English' }, isRequired: true, provenance: 'EMPLOYER_CONFIRMED' }] });
const request = liveAgendaRequest(rubric);
assert.deepEqual(request.data.criteria.map(row => row.name), responsibilities);
const [demo, sameDemo, anotherDemo, proposal, validation, discovery, admin] = rubric.criteria.map(row => row.id);
const [demoRef, sameDemoRef, anotherDemoRef, proposalRef, validationRef, discoveryRef] = request.data.criteria.map(row => row.id);
const provider = {
    topics: [
        { criterionId: discoveryRef, equivalentIds: [], question: 'Gimana lu akan mencari tahu kebutuhan utama klien sebelum menawarkan solusi?' },
        { criterionId: demoRef, equivalentIds: [sameDemoRef, anotherDemoRef], question: 'Apa yang bakal lu siapin sebelum mendemokan solusi ke pelanggan?' },
        { criterionId: proposalRef, equivalentIds: [], question: 'Bagaimana lu menentukan isi proposal teknis berdasarkan kebutuhan klien?' },
        { criterionId: validationRef, equivalentIds: [], question: 'Bagaimana lu akan menguji konfigurasi pelanggan sebelum solusi dipakai?' },
    ],
};
const agenda = prepareLiveAgenda(rubric, provider);
assert.equal(agenda.source, 'JOB_REQUIREMENTS');
assert.deepEqual(agenda.topics.map(row => row.criterionId), [discovery, demo, proposal, validation]);
assert.deepEqual(agenda.topics[1].equivalentIds, [sameDemo, anotherDemo]);
assert.deepEqual(agenda.deferredIds, [admin]);
assert.equal(prepareLiveAgenda(rubric, structuredClone(provider)).revision, agenda.revision);
const liveRubric = liveAgendaRubric(rubric, agenda);
assert.deepEqual(liveRubric.interviewIds, [discovery, demo, proposal, validation]);
assert.equal(liveRubric.revision, rubric.revision);
assert.deepEqual(cvCriteria(liveRubric), cvCriteria(rubric));
assert.equal(rubric.interviewIds.includes(validation), false, 'validation was displaced by duplicate topics in the original agenda');

for (const invalid of [undefined, { topics: [] }, { topics: [{ ...provider.topics[0], criterionId: 'unknown' }] }]) {
    const fallback = prepareLiveAgenda(rubric, invalid);
    assert.equal(fallback.source, 'FROZEN_RUBRIC');
    assert.deepEqual(fallback.topics.map(row => row.criterionId), rubric.interviewIds);
}
for (const question of ['Gimana jadinya?', 'Gimana cara lu mengerjakan tugas berikut?',
    'Jelaskan pendekatan lu? Apa yang lu lakukan?', provider.topics[0].question]) {
    const prepared = prepareLiveAgenda(rubric, { topics: [provider.topics[0], { ...provider.topics[1], question }, ...provider.topics.slice(2)] });
    assert.equal(prepared.source, 'JOB_REQUIREMENTS');
    assert.equal(prepared.topics[0].question, provider.topics[0].question);
    assert.equal(prepared.topics[1].question, rubric.criteria.find(row => row.id === demo)?.question);
}
const incomplete = prepareLiveAgenda(rubric, { topics: [provider.topics[0],
    { ...provider.topics[1], equivalentIds: [sameDemoRef, sameDemoRef, anotherDemoRef, 'unknown'] }, provider.topics[2], provider.topics[2]] });
assert.deepEqual(incomplete.topics.map(row => row.criterionId), [discovery, demo, proposal, validation]);
assert.deepEqual(incomplete.topics[1].equivalentIds, [sameDemo, anotherDemo]);

const claim = (id: string, criterionId: string, skill: string, quote: string, scope: Claim['scope']): Claim => ({
    id, criterionId, skill, statement: skill, quote, scope, lineStart: 1, lineEnd: 1, question: 'Kapan lu pernah memakai keahlian itu?',
});
const claims = [claim('claim-demo', demo, 'SQL', 'Keahlian SQL', 'GENERAL'),
    claim('claim-proposal', proposal, 'Penyusunan SLA', 'Menyusun SLA pada proposal teknis. Hubungi kandidat@example.test.', 'CONTEXTUAL'),
    claim('claim-not-selected', admin, 'Koordinasi', 'Membuat jadwal', 'GENERAL')];
const packet = liveRolePackage(rubric, agenda);
const plan = attachLiveRoleTopics({ claims, limitations: [] }, rubric, packet.liveAgenda);
assert.deepEqual(plan.roleTopics?.map(row => row.cvClaimId), [undefined, 'claim-demo', 'claim-proposal', undefined]);
assert.deepEqual(plan.roleTopics?.map(row => row.question), agenda.topics.map(row => row.question));
const topics = taraTopics(plan, packet, true).map(topic => ({ ...topic, skill: claims.find(row => row.criterionId === topic.criterionId)?.skill,
    fields: topic.criterionId === proposal ? [...(topic.fields ?? []), 'CONTEXT' as const] : topic.fields }));
const live = createVoiceRequest('marin', 'synthetic', topics);
const data = JSON.parse(live.session.input[0].content[0].text.split('\n')[1]);
assert.deepEqual(data.map((item: { criterionId: string }) => item.criterionId), liveRubric.interviewIds);
assert.deepEqual(data.map((item: { context: string }) => item.context), ['WORK_SCENARIO', 'CV_MENTION', 'EXPLICIT_CV_CONTEXT', 'WORK_SCENARIO']);
assert.equal(data[1].skill, 'SQL');
assert.doesNotMatch(JSON.stringify(data), /kandidat@example\.test/u);
assert.match(live.session.instructions, /Jangan menanyakan kembali fakta yang sama dengan kalimat lain/u);
assert.match(live.session.instructions, /11 menit/u);
assert.equal(live.session.model, 'gpt-live-1');
assert.deepEqual(live.session.delegation, { type: 'client' });

console.log('Tara Live agenda: grouped meaning, distinct duties, source IDs, evidence scope, CV revision, fallback and session startup passed. Paid calls: 0.');
