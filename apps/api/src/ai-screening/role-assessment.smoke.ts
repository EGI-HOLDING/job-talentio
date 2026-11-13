import assert from 'node:assert/strict';
import { attachRoleTopics, createRoleRubric, rolePackage } from './role-rubric';
import { taraTopics } from './tara-interview';
import { acceptRoleJudgements, freezeRoleAssessment, prepareRoleEvidence, roleChatTranscript, roleEvaluationRequest,
    roleLiveTranscript, scoreRoleAssessment, type RoleTranscriptEntry } from './taka-role-assessment';
import { createVoiceRequest } from './prompts/voice-session';
import { roleVoiceEvidence, startRoleVoice, stepRoleVoice } from './voice/voice-role';
import { droppedOutputRecoveryAt, reflectedInputActive, roleRedirectQuestion } from './voice/voice-redirect';
import type { NativeDelivery } from './voice/voice-native';
import type { Fragment } from './voice/voice.policy';

const job = { title: 'Presales Engineer', responsibilities: ['Rancang demo teknis SQL', 'Susun proposal teknis',
    'Klarifikasi kebutuhan pelanggan', 'Validasi rancangan solusi', 'Kelola dokumentasi internal'],
    jobSkills: [{ skill: { name: 'SQL', aliases: [{ alias: 'Structured Query Language' }] }, isRequired: true },
        { skill: { name: 'Structured Query Language', aliases: [{ alias: 'SQL' }] }, isRequired: true },
        { skill: { name: 'Networking', aliases: [] }, isRequired: false }],
    jobLanguages: [{ language: { name: 'English' }, isRequired: true, provenance: 'LEGACY_UNVERIFIED' }], experienceYearsMin: 0 };
const rubric = createRoleRubric(job);
assert.equal(rubric.interviewIds.length, 4);
assert.equal(rubric.criteria.length, 5, 'required skill and alias belong to the duty without adding a second grade');
assert.equal(rubric.revision, createRoleRubric({ ...job, jobSkills: [...job.jobSkills].reverse() }).revision);
assert.notEqual(rubric.revision, createRoleRubric({ ...job, responsibilities: ['Rancang demo nonteknis'] }).revision);
const plan = attachRoleTopics({ claims: [], limitations: [] }, rubric);
const topics = taraTopics(plan, rolePackage(rubric), true);
assert.deepEqual(topics.map(topic => topic.id), rubric.interviewIds, 'no CV mention still allows core scenarios');
assert.ok(topics.every(topic => topic.alternative));
const request = createVoiceRequest('marin', 'sdp', topics, true);
assert.equal(request.session.model, 'gpt-live-1');
assert.equal(request.session.delegation.type, 'client');
assert.match(JSON.stringify(request.session.input), /Halo, gue Tara/);
assert.doesNotMatch(JSON.stringify(request.session.input), /Susun proposal teknis/, 'future slots are supplied by the server');
assert.doesNotMatch(request.session.instructions, /Keluarkan hanya JSON/u, 'the spoken interview must not inherit a JSON-only instruction');
assert.match(createVoiceRequest('marin', 'sdp', topics).session.instructions, /Tunggu kandidat selesai bicara/u);

const [demo, proposal, discovery, validation] = rubric.interviewIds;
const question = (id: string, topicId: string, at: number, opportunity: RoleTranscriptEntry['opportunity'] = 'ANSWERED'): RoleTranscriptEntry =>
    ({ id, topicId, speaker: 'TARA', startMs: at, endMs: at + 100, text: 'Bagaimana cara lu mengerjakannya?', question: true, opportunity });
const answer = (id: string, at: number, text: string): RoleTranscriptEntry =>
    ({ id, speaker: 'CANDIDATE', startMs: at, endMs: at + 100, text });
const twoSkills = 'Saya siapkan dataset sintetis untuk demo SQL. Untuk proposal, saya dokumentasikan SLA dan biaya secara terpisah.';
const transcript = [question('demo-q', demo, 100), answer('demo-a', 300, twoSkills),
    question('discovery-q', discovery, 500), answer('discovery-a', 800, 'Saya belum bisa menjelaskan cara menggali kebutuhan pelanggan.'),
    question('validation-q', validation, 1000, 'UNVERIFIED'), answer('validation-a', 1300, 'Saya akan uji beban dengan data sintetis dan ukur p95 untuk cek SLA.')];
const evidence = prepareRoleEvidence(rubric, transcript, plan);
assert.equal(evidence.catalog.length, 3, 'collect every stored candidate turn including an interrupted last answer');
const judged = (level: number, clarity: number, ref: string, q: string | null = null, basis = 'EVIDENCE', redirectRef: string | null = null) =>
    ({ level, clarity, basis, evidence: ['answer:' + ref + ':0'], questionRef: q, redirectRef, discrepancyRef: null, reason: 'Bukti sesuai rubrik.' });
const grades = { criteria: {
    [demo]: judged(4, 4, 'demo-a', 'demo-q'), [proposal]: judged(3, 4, 'demo-a'),
    [discovery]: judged(0, 0, 'discovery-a', 'discovery-q', 'DECLINED'), [validation]: judged(4, 3, 'validation-a'),
} };
const result = scoreRoleAssessment(evidence, acceptRoleJudgements(evidence, grades), 80, true);
assert.equal(result.finalScore, 72.2);
assert.deepEqual(result.result.roleAssessment?.components, { cv: 80, competency: 68.8, explanation: 68.8 });
assert.deepEqual(result.result.roleAssessment?.contributions, { cv: 24, competency: 41.28, explanation: 6.88 });
assert.deepEqual(result.result.roleAssessment?.criteria.map(row => row.level), [4, 3, 0, 4]);
assert.equal(result.result.roleAssessment?.criteria[1].evidence[0].quote, twoSkills);
assert.equal(scoreRoleAssessment(evidence, acceptRoleJudgements(evidence, grades), null, true).finalScore, null);
const forged = structuredClone(grades);
forged.criteria[proposal].evidence = ['answer:other-session:0'];
forged.criteria[discovery].questionRef = 'validation-q';
const partial = scoreRoleAssessment(evidence, acceptRoleJudgements(evidence, forged), 80, true);
assert.equal(partial.finalScore, null);
assert.deepEqual(partial.result.roleAssessment?.criteria.map(row => row.level), [4, null, 0, 4]);
assert.equal(acceptRoleJudgements(evidence, forged).has(discovery), false, 'the zero comes from the stored refusal, not the invalid model reference');
assert.deepEqual(partial.result.roleAssessment?.missing, ['COVERAGE']);
assert.equal(acceptRoleJudgements(evidence, { criteria: { [validation]: judged(0, 0, 'validation-a', 'validation-q', 'DECLINED') } }).size, 0);
assert.equal(acceptRoleJudgements(evidence, { criteria: { [demo]: judged(1, 0, 'demo-a', 'demo-q') } }).size, 1,
    'a relevant concept with no explained action can be graded separately from clarity');
const redirection = [...transcript.slice(0, 4), question('validation-q', validation, 1000),
    answer('validation-a', 1300, 'Saya mau cerita soal jalan-jalan.'), question('validation-rephrase', validation, 1500),
    answer('off-topic', 1800, 'Saya ingin cerita soal liburan.')];
const beforeRedirect = judged(0, 0, 'validation-a', 'validation-q', 'AFTER_REDIRECTION');
assert.equal(acceptRoleJudgements(evidence, { criteria: { [validation]: beforeRedirect } }).size, 0);
const redirected = prepareRoleEvidence(rubric, redirection, plan);
const afterRedirect = judged(0, 0, 'off-topic', 'validation-q', 'AFTER_REDIRECTION', 'validation-rephrase');
assert.equal(acceptRoleJudgements(redirected, { criteria: { [validation]: afterRedirect } }).size, 1);
const untouched = createRoleRubric({ title: job.title, jobSkills: [], jobLanguages: [] });
assert.deepEqual(scoreRoleAssessment(prepareRoleEvidence(untouched, [], plan), new Map(), null, false)
    .result.roleAssessment?.missing, ['CV', 'RUBRIC']);
const chat = roleChatTranscript([{ id: 'one', claimId: demo, text: 'Apa yang lu lakukan?', answer: 'Saya buat demo SQL.',
    shownAt: new Date(1000), answeredAt: new Date(1500), timedOut: false },
    { id: 'draft', claimId: proposal, text: 'Gimana soal proposal?', answer: null, shownAt: null, answeredAt: null, timedOut: false }]);
assert.deepEqual(chat.map(row => row.id), ['question:one', 'answer:one']);
assert.deepEqual(roleEvaluationRequest(prepareRoleEvidence(rubric, chat, plan), freezeRoleAssessment()).data.transcript, chat);
const contact = prepareRoleEvidence(rubric, [answer('contact', 0, 'Hubungi contoh@synthetic.test')], plan);
assert.equal(roleEvaluationRequest(contact, freezeRoleAssessment()).data.transcript[0].text, 'Hubungi [email]');
const verifiedSilence = prepareRoleEvidence(rubric, [question('silence', demo, 0, 'SILENCE')], plan);
assert.equal(scoreRoleAssessment(verifiedSilence, new Map(), 80, false).result.roleAssessment?.criteria[0].level, 0);
const refused = prepareRoleEvidence(rubric, [question('direct', demo, 0),
    answer('decline', 200, 'Maaf, saya belum bisa menjelaskan cara mengerjakan tugas itu.')], plan);
assert.equal(scoreRoleAssessment(refused, new Map(), 80, false).result.roleAssessment?.criteria[0].level, 0);
const qualified = prepareRoleEvidence(rubric, [question('direct', demo, 0),
    answer('qualified', 200, 'Saya belum bisa menjelaskan cara lengkap, tapi saya akan mulai dengan dataset sintetis.')], plan);
assert.equal(scoreRoleAssessment(qualified, new Map(), 80, false).result.roleAssessment?.criteria[0].level, null);

const origin = 1_000_000;
const fragments: Fragment[] = [
    { id: 1, speaker: 'TARA', startMs: 100, endMs: 450, text: 'Halo, gue Tara. ' },
    { id: 2, speaker: 'TARA', startMs: 870, endMs: 1090, text: 'Gimana cara lu ' },
    { id: 3, speaker: 'TARA', startMs: 1538, endMs: 1810, text: 'nunjukin solusi ini?' },
    { id: 4, speaker: 'TARA', startMs: 1880, endMs: 2200, text: ' Coba ambil waktu.' },
    { id: 5, speaker: 'CANDIDATE', startMs: 1930, endMs: 3200, text: twoSkills },
    { id: 6, speaker: 'TARA', startMs: 3500, endMs: 4300, text: 'Dataset sintetis lu bantu jaga data pelanggan.' },
];
const window = (start: number, end: number, interrupted?: boolean) => ({ start: origin + start, end: origin + end, interrupted });
const delivery: NativeDelivery = { firstAudible: origin + 100, sequence: 7,
    windows: [window(100, 450), window(870, 1090), window(1538, 1820), window(3500, 4300)] };
const state = startRoleVoice(topics);
const playback = roleVoiceEvidence([...fragments].reverse(), delivery, state);
assert.equal(playback.evidence[0].heard, true, 'split playback and trailing speech preserve the question');
assert.equal(playback.evidence[0].questionEndMs, 1810);
assert.deepEqual(roleLiveTranscript(playback.evidence, true).map(row => [row.id, row.opportunity]),
    [['v1', 'ANSWERED'], ['v5', undefined], ['v6', undefined]]);
const cut = { ...delivery, windows: [...delivery.windows.slice(0, 2), window(1538, 1670, true)] };
assert.equal(roleVoiceEvidence(fragments, cut, state).evidence[0].heard, false, 'interrupted playback cannot verify a question');
assert.equal(stepRoleVoice(state, topics, fragments, delivery, origin, origin + 5100, false, origin + 4700), undefined,
    'recent microphone activity overrides an early recap and an incomplete transcript');
assert.equal(state.slot, 0);
assert.equal(stepRoleVoice(state, topics, fragments, delivery, origin, origin + 5100, false), 'NEXT');
assert.equal(state.slot, 1);
const echo = [...fragments, { id: 7, speaker: 'TARA', startMs: 6400, endMs: 6800, text: 'Bagaimana lu nunjukin solusi ini?' }];
const echoDelivery = { ...delivery, windows: [...delivery.windows, window(6400, 6800)] };
assert.equal(stepRoleVoice(state, topics, echo, echoDelivery, origin, origin + 7100, false), 'REFOCUS');
assert.deepEqual(state.slots[1].questionRefs, []);
assert.equal(roleVoiceEvidence(echo, echoDelivery, state).evidence.at(-1)?.topicId, demo);
assert.equal(stepRoleVoice(state, topics, echo, echoDelivery, origin, origin + 7500, false), undefined);
assert.equal(stepRoleVoice(state, topics, fragments, delivery, origin, origin + 840000, true), 'CLOSE');
assert.equal(stepRoleVoice(state, topics, fragments, delivery, origin, origin + 848000, true), 'END');
assert.equal(state.slot, 1, 'closing cannot open another topic');
const clock = startRoleVoice(topics);
assert.equal(stepRoleVoice(clock, topics, [], delivery, origin, origin + 165_000, false, origin + 164_700), undefined,
    'a topic deadline waits for the candidate to stop speaking');
for (const minute of [2.75, 5.5, 8.25]) assert.equal(stepRoleVoice(clock, topics, [], delivery, origin, origin + minute * 60_000, false), 'NEXT');
assert.equal(clock.slot, 3);
assert.equal(stepRoleVoice(clock, topics, [], delivery, origin, origin + 660000, false), 'CLOSE');

const redirectAnswer: Fragment = { id: 10, speaker: 'CANDIDATE', startMs: 2000, endMs: 6200,
    text: 'Saya sedang cerita soal perjalanan liburan saya.' };
const redirectLead: Fragment = { id: 11, speaker: 'TARA', startMs: 4000, endMs: 4700, text: 'Gue tarik balik ke demo teknis ya.' };
const redirectCut: Fragment = { ...redirectLead, text: 'Gimana cara lu—' };
const redirectQuestion: Fragment = { ...redirectLead, startMs: 9000, endMs: 9900, text: 'Gimana cara lu validasi hasil demo SQL?' };
const initial = fragments.slice(0, 3);
const initialPlayback = delivery.windows.slice(0, 3);
const recorded = (extras: NativeDelivery['windows']): NativeDelivery => ({ ...delivery, windows: [...initialPlayback, ...extras] });
const step = (control: ReturnType<typeof startRoleVoice>, turns: Fragment[], media: NativeDelivery, at: number, micAt?: number) =>
    stepRoleVoice(control, topics, turns, media, origin, origin + at, false, micAt === undefined ? undefined : origin + micAt);
for (const incomplete of [redirectLead, redirectCut, { ...redirectLead, text: 'Gue tarik balik ke demo. Gimana cara lu?' }]) {
    const control = startRoleVoice(topics);
    const turns = [...initial, redirectAnswer, incomplete];
    const media = recorded([window(4000, 4700)]);
    assert.equal(roleVoiceEvidence(turns, media, control).evidence.at(-1)?.question, false, 'unfinished redirect is not a question');
    assert.equal(step(control, turns, media, 7900, 7500), undefined, 'let the candidate keep speaking');
    assert.equal(step(control, turns, media, 8100), 'REDIRECT');
    assert.equal(step(control, turns, media, 9000), undefined, 'request the correction once per topic');
    assert.deepEqual(control.slots[0].questionRefs, ['v1']);
    const revised = [...turns, { ...redirectQuestion, id: 12 }];
    const played = recorded([window(4000, 4700), window(9000, 9900)]);
    assert.equal(step(control, revised, played, 11_800), undefined, 'wait for an answer to the repaired question');
    assert.deepEqual(control.slots[0].questionRefs, ['v1', 'v12']);
    assert.equal(control.slots[0].redirect?.pending, false);
}
const complete = startRoleVoice(topics);
const fullRedirect = { ...redirectLead, endMs: 5100, text: 'Balik ke SQL, bagian mana yang lu kerjain sendiri?' };
assert.equal(step(complete, [...initial, redirectAnswer, fullRedirect], recorded([window(4000, 5100)]), 8100), undefined);
assert.deepEqual(complete.slots[0].questionRefs, ['v1', 'v11'], 'a complete redirect counts once and needs no repair');
const splitRedirect = [
    { ...redirectLead, text: 'Gue tarik balik ya ke demo teknis. ' },
    { ...redirectQuestion, id: 12, startMs: 5200, endMs: 5800 },
    { ...redirectQuestion, id: 13, startMs: 5950, endMs: 6150, text: '?' },
];
const splitRedirectControl = startRoleVoice(topics);
assert.equal(step(splitRedirectControl, [...initial, redirectAnswer, ...splitRedirect], recorded([window(5200, 5800)]), 8100), undefined);
assert.deepEqual(splitRedirectControl.slots[0].questionRefs, ['v1', 'v11'], 'a missed preamble or punctuation does not erase the audible question');
const earlySignoff = { ...redirectLead, startMs: 3800, text: 'Makasih, wawancara kita sudah selesai.' };
const stillSpeaking = startRoleVoice(topics);
assert.equal(step(stillSpeaking, [...initial, redirectAnswer, earlySignoff], recorded([window(3800, 4700)]), 8500, 7800), undefined);
assert.equal(stillSpeaking.close, undefined, 'an unsolicited signoff does not close an active answer');
assert.equal(stepRoleVoice(stillSpeaking, topics, [...initial, redirectAnswer], delivery, origin, origin + 840_000, true, origin + 839_850), undefined,
    'the closing announcement waits for the candidate to stop');
assert.equal(stepRoleVoice(stillSpeaking, topics, [...initial, redirectAnswer], delivery, origin, origin + 842_000, true, origin + 839_850), 'CLOSE');
assert.match(roleRedirectQuestion(topics[0]), /demo teknis SQL.*\?$/u, 'the recovery prompt names the active task');
assert.equal(reflectedInputActive(Buffer.alloc(960).toString('base64')), false);
const pcm = Buffer.alloc(960);
for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(1000, i);
assert.equal(reflectedInputActive(pcm.toString('base64')), true);
assert.equal(reflectedInputActive(123), false);
assert.equal(droppedOutputRecoveryAt(2000, 6000), 9500, 'recovery waits for the candidate even if the output was dropped much earlier');
assert.equal(droppedOutputRecoveryAt(6000, 3000), 10_500, 'give native playback a chance to recover first');
const mutedReply = startRoleVoice(topics);
assert.equal(stepRoleVoice(mutedReply, topics, fragments, delivery, origin, origin + 5100, false, undefined, true), undefined,
    'do not skip a topic while restoring a response blocked by the player');
console.log('Role assessment passed: frozen criteria, CV aliases, scenarios without CV claims, Live delivery, topic limits, source integrity, cross-topic evidence, and complete-score requirements. Paid calls: 0.');
