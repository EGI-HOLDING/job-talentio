import assert from 'node:assert/strict';
import { buildCandidatePreparation, candidateEvidence, type CandidateJob } from './candidate-preparation';
import { screeningPreparation } from './screening-preparation';
import { TIMED_CONVERSATION } from './conversation.policy';
import { validQuestion, type PackagePayload } from './screening.schemas';
import { taraTopics } from './tara-interview';

const criteria = [
    { id: 'campaign', name: 'Digital campaign', requirementRef: 'Membuat materi kampanye', anchors: [] },
    { id: 'tooling', name: 'Software tools', requirementRef: 'Menggunakan C++', anchors: [] },
];
const rubric: PackagePayload = { context: 'Synthetic', criteria };
const cv = [
    'Synthetic Candidate',
    'hidden@example.test (TypeScript)',
    '+628123456789',
    'C++ dan C#',
    'Photoshop, UI–UX, PS',
    'Membantu tim membuat materi kampanye dengan Figma, meningkatkan interaksi 20%.',
    'Belum pernah pakai Blender.',
    'Created digital campaign assets',
    'using Illustrator.',
    Array.from({ length: 50 }, (_, i) => 'Tool' + (i + 1)).join(', '),
].join('\n');
const segments = candidateEvidence(cv, 'Synthetic Candidate');
const job: CandidateJob = { responsibilities: [criteria[0].requirementRef], jobSkills: [
    { skillId: 'ps', isRequired: true, skill: { name: 'Photoshop', aliases: [{ alias: 'PS', aliasKey: 'ps' }] } },
    { skillId: 'cpp', isRequired: true, skill: { name: 'C++' } },
] };
const proposal = (sourceRef: string, skillText: string, criterionId = 'campaign', relevance = 'CORE') => ({ sourceRef, skillText, criterionId, relevance });
const assemble = (claims: unknown[], requested: CandidateJob = job) => buildCandidatePreparation(segments, rubric, requested, [{ claims }]);

for (let repeat = 0; repeat < 3; repeat++) {
    assert.ok(segments.every(segment => !/Synthetic Candidate|@|628123456789/.test(segment.text)));
    assert.deepEqual(assemble([
        proposal('cv-2-1', 'TypeScript'), proposal('cv-4-1', 'C'), proposal('cv-5-1', 'UI-UX'),
        proposal('cv-4-1', 'C#', 'tooling'), proposal('cv-7-1', 'Blender'), proposal('cv-5-1', 'Photoshop', 'fake'),
        proposal('cv-8-wrap', 'Illustrator'), proposal('cv-5-1', 'Photoshop'),
    ]).payload.claims.map(claim => claim.skill), ['Photoshop', 'Illustrator', 'UI-UX', 'C#']);
    const role = assemble([proposal('cv-6-1', 'Figma')]).payload.claims[0];
    assert.equal(role.scope, 'CONTEXTUAL');
    assert.deepEqual(role.extraEvidence?.map(item => item.field), ['CONTEXT', 'ROLE_BOUNDARY', 'RESULT']);
    const general = assemble([{ ...proposal('cv-5-1', 'Photoshop'), scope: 'CONTEXTUAL', question: 'Ceritakan proyek itu?' }]).payload.claims[0];
    assert.equal(general.scope, 'GENERAL');
    assert.deepEqual(general.extraEvidence, []);
    assert.doesNotMatch(general.question, /proyek itu|kampanye/);
    assert.ok(validQuestion(general.question, TIMED_CONVERSATION));
    assert.equal(assemble([proposal('cv-5-1', 'PS'), proposal('cv-5-1', 'Photoshop')]).payload.claims.length, 1);
    const ambiguous = { jobSkills: [...job.jobSkills!, { skillId: 'ps-two', skill: { name: 'Presentation', aliases: [{ alias: 'PS', aliasKey: 'ps' }] } }] };
    assert.deepEqual(assemble([], ambiguous).payload.claims.map(claim => claim.skill), ['Photoshop', 'C++']);
    assert.equal(assemble([], { jobSkills: [{ skill: { name: 'C' } }] }).payload.claims.length, 0);
    assert.equal(assemble([proposal('cv-5-1', 'C++')]).rejected, 1);
    assert.equal(assemble([proposal('cv-10-1', 'Tool50')], {}).payload.claims[0]?.skill, 'Tool50');
    assert.equal(assemble([proposal('cv-6-1', 'Figma', 'campaign', 'SUPPORTING'), proposal('cv-5-1', 'PS')]).payload.claims[0].skill, 'PS');
    const fallback = assemble([null, {}, { ...proposal('cv-4-1', 'C++'), relevance: 'invalid' }]);
    assert.deepEqual(fallback.payload.claims.map(claim => claim.skill), ['Photoshop', 'C++']);
    const alternative = buildCandidatePreparation(segments, rubric, job, [], { alternativeOnly: true });
    assert.equal(alternative.payload.claims.length, 0);
    assert.equal(taraTopics(alternative.payload, rubric, true)[0].alternative, true);
    assert.match(alternative.payload.alternativeQuestion!, /Membuat materi kampanye/i);

    const legacy = (skill: string, quote: string, lineStart: number) => ({
        skill, quote, criterionId: 'campaign', lineStart, lineEnd: lineStart, relevance: 'CORE',
        extraEvidence: [{ field: 'RESULT', cvQuote: 'A result absent from the CV' }],
    });
    const stored = [
        { claims: [legacy('Figma', segments.find(segment => segment.id === 'cv-6-1')!.text, 6), legacy('Invented', 'none', 1)] },
        { claims: [legacy('TypeScript', 'hidden@example.test (TypeScript)', 2), legacy('C', 'C++ dan C#', 4)] },
        { claims: [legacy('UI–UX', 'Photoshop, UI–UX, PS', 5), legacy('Photoshop', 'Membuat materi kampanye', 6)] },
    ];
    const recovered = buildCandidatePreparation(segments, rubric, job, stored, { recoverStored: true });
    assert.deepEqual(recovered.payload.claims.map(claim => [claim.skill, claim.scope]), [
        ['Photoshop', 'GENERAL'], ['Figma', 'CONTEXTUAL'], ['UI-UX', 'GENERAL'],
    ]);
    assert.equal(recovered.rejected, 3);
    assert.deepEqual(buildCandidatePreparation(segments, rubric, {}, [{ claims: [{
        ...legacy('Photoshop', 'Photoshop, UI–UX, PS', 5), ...proposal('bogus', 'Photoshop'),
    }] }], { recoverStored: true }).payload.claims, []);
    assert.deepEqual(screeningPreparation({ resumeId: 'cv', resumeVersion: { screeningSource: { status: 'READY', text: '  ' } } }),
        { status: 'FAILED', planId: null, reason: 'CV_UNREADABLE' });
}
console.log('Tara candidate preparation: mixed proposals, source grounding, tech boundaries, contextual evidence, 50 skills, fallback, and stored recovery passed 3 runs.');
