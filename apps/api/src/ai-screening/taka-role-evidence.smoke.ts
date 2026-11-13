import assert from 'node:assert/strict';
import { attachRoleTopics, createRoleRubric } from './role-rubric';
import { prepareRoleEvidence, roleLiveTranscript, scoreRoleAssessment, type RoleTranscriptEntry } from './taka-role-assessment';
import { acceptRoleEvidence, roleEvidenceReferences, roleEvidenceRequest } from './taka-role-evidence';
import { directFarewellAt, roleAssessmentVoiceEvidence, roleVoiceEvidence } from './voice/voice-role';
import type { NativeDelivery } from './voice/voice-native';

const rubric = createRoleRubric({ title: 'Presales Engineer', responsibilities: ['Susun proposal', 'Sepakati ruang lingkup',
    'Tinjau keamanan', 'Validasi integrasi'], jobSkills: [], jobLanguages: [] });
const [proposal, scope, security, integration] = rubric.interviewIds;
const plan = attachRoleTopics({ claims: [], limitations: [] }, rubric);
function question(id: string, topicId: string, startMs: number, opportunity: RoleTranscriptEntry['opportunity'] = 'ANSWERED'): RoleTranscriptEntry {
    return { id, topicId, speaker: 'TARA', question: true, startMs, endMs: startMs + 500, opportunity,
        text: 'Langkah apa yang lu ambil dalam tugas ini?' };
}
function answer(id: string, startMs: number, text: string): RoleTranscriptEntry {
    return { id, speaker: 'CANDIDATE', text, startMs, endMs: startMs + 350 };
}
const input = prepareRoleEvidence(rubric, [question('v1', proposal, 0, 'UNVERIFIED'),
    answer('v2', 650, 'Saya menulis proposal biaya dan membandingkan dua alternatif arsitektur sebelum memilih prototipe.'),
    answer('v3', 1150, 'Saya menguji kelayakan teknis sebelum memberikan rancangan ke atasan.'),
    question('v4', security, 2000), answer('v5', 2600, 'Saya tidak bisa menjawab pertanyaan ini.'),
    question('v6', integration, 4000), answer('v7', 4600, 'Saya membantu pantry kantor.'),
    question('v8', integration, 6000), answer('v9', 6600, 'Saya suka bermain bulu tangkis.')], plan);
const refs = roleEvidenceReferences(input), ids = rubric.interviewIds;
const request = roleEvidenceRequest(input, refs, ids);
const schema = request.preset.schema.properties!.criteria.properties![proposal].properties!;
assert.match('q1', new RegExp(schema.questionRef.anyOf![0].pattern!));
assert.doesNotMatch(proposal, new RegExp(schema.questionRef.anyOf![0].pattern!));
const proposalRow = { level: 4, clarity: 4, basis: 'EVIDENCE', reason: 'Kandidat menulis proposal dan membandingkan alternatif.',
    questionRef: proposal, redirectRef: null, evidence: ['a1'], actionRef: 'a1', discrepancyRef: null, fit: 'DIRECT', requiresQuestionContext: false };
const scopeRow = { ...proposalRow, questionRef: scope, evidence: ['a2'], actionRef: null, fit: 'TRANSFERABLE',
    reason: 'Uji kelayakan membantu persiapan pembahasan ruang lingkup.' };
const zero = { ...proposalRow, level: 0, clarity: 0, basis: 'DECLINED', questionRef: 'q2', evidence: ['a3'], actionRef: null,
    fit: null, reason: 'Kandidat menyatakan belum bisa menjawab.' };
const offTopic = { ...zero, basis: 'AFTER_REDIRECTION', questionRef: 'q3', redirectRef: 'q4', evidence: ['a4', 'a5'],
    reason: 'Kedua jawaban membahas topik lain setelah diarahkan.' };
const accepted = acceptRoleEvidence(input, refs, { criteria: { [proposal]: proposalRow, [scope]: scopeRow,
    [security]: zero, [integration]: offTopic } }, ids);
assert.deepEqual([...accepted.values()].map(row => row.level), [4, 2, 0, 0]);
assert.equal(accepted.get(proposal)?.questionRef, null);
assert.equal(accepted.get(proposal)?.evidence[0], 'answer:v2:0');
assert.equal(acceptRoleEvidence(input, refs, { criteria: { [proposal]: { ...proposalRow, requiresQuestionContext: true },
    [scope]: { ...scopeRow, evidence: ['a999'] }, [security]: { ...zero, questionRef: 'q1' },
    [integration]: { ...offTopic, evidence: ['a5'] } } }, ids).size, 0);
assert.equal(acceptRoleEvidence(input, refs, { criteria: { [proposal]: { ...proposalRow, actionRef: null } } }, ids).size, 0);
assert.equal(acceptRoleEvidence(input, refs, { criteria: { [proposal]: { ...proposalRow, evidence: ['answer:other-session:0'] } } }, ids).size, 0);
assert.equal(acceptRoleEvidence(input, refs, { criteria: { [proposal]: { ...proposalRow, basis: 'DECLINED', level: 0, clarity: 0,
    questionRef: 'q1', fit: null, actionRef: null } } }, ids).size, 0, 'unverified playback cannot lead to 0');

const onlyProposal = new Map([[proposal, accepted.get(proposal)!]]);
const partial = scoreRoleAssessment(input, onlyProposal, 80, true, undefined, { unavailable: new Set([scope]) });
assert.equal(partial.finalScore, null);
assert.equal(partial.score, null);
assert.deepEqual(partial.result.roleAssessment?.partial, { competency: 100, explanation: 100 });
assert.equal(partial.result.roleAssessment?.criteria[1].state, 'ASSESSMENT_UNAVAILABLE');
const complete = scoreRoleAssessment(input, accepted, 80, false, undefined, { unavailable: new Set() });
assert.equal(complete.finalScore, 51.5);
assert.equal(scoreRoleAssessment(input, accepted, null, false, undefined, { unavailable: new Set() }).finalScore, null);
const noAnswer = { level: null, clarity: null, basis: 'INSUFFICIENT', reason: 'Kesempatan belum cukup.', evidence: [],
    questionRef: 'q1', redirectRef: null, discrepancyRef: null, fit: null, actionRef: null, requiresQuestionContext: false };
const unverified = acceptRoleEvidence(input, refs, { criteria: { [proposal]: noAnswer } }, ids);
assert.equal(scoreRoleAssessment(input, unverified, null, false, undefined, { unavailable: new Set() }).result.roleAssessment?.criteria[0].state,
    'PLAYBACK_UNVERIFIED');

const fragments = [{ id: 1, speaker: 'TARA', text: 'Konteks itu membantu. ', startMs: 100, endMs: 530 },
    { id: 2, speaker: 'TARA', text: 'Apa keputusan lu tentang ruang lingkup?', startMs: 630, endMs: 1200 },
    { id: 3, speaker: 'CANDIDATE', text: 'Saya minta klien menyetujui daftar hasil kerja.', startMs: 1900, endMs: 2300 }];
const audio: NativeDelivery = { sequence: 2, playbackVerified: true, firstAudioMs: 100, firstAudible: 1100,
    windows: [{ start: 1980, end: 2350 }] };
assert.equal(roleVoiceEvidence(fragments, audio, undefined, true).evidence[0].heard, false);
assert.equal(roleLiveTranscript(roleAssessmentVoiceEvidence(fragments, audio), false, true)[0].opportunity, 'ANSWERED');
const cut = { ...audio, windows: [{ start: 1980, end: 2090, interrupted: true }, { start: 2100, end: 2350 }] };
assert.equal(roleLiveTranscript(roleAssessmentVoiceEvidence(fragments, cut), false, true)[0].opportunity, 'PLAYBACK_INTERRUPTED');
assert.equal(roleAssessmentVoiceEvidence(fragments, { ...audio, windows: [{ start: 1981, end: 2350 }] })[0].heard, false);
assert.equal(roleAssessmentVoiceEvidence(fragments, { ...audio, playbackVerified: false })[0].heard, false);
assert.equal(directFarewellAt(fragments, audio), undefined);
console.log('Taka evidence v2 passed: typed references, independent evidence, transfer cap, review and playback states, valid zero, partial maths and audio boundaries.');
