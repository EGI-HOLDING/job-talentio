import assert from 'node:assert/strict';
import { attachRoleTopics, createRoleRubric, rolePackage } from './role-rubric';
import { taraTopics } from './tara-interview';
import { acceptRoleJudgements, freezeRoleAssessment, prepareRoleEvidence, roleChatTranscript, roleEvaluationRequest,
    roleLiveTranscript, scoreRoleAssessment, type RoleTranscriptEntry } from './taka-role-assessment';
import { createVoiceRequest } from './prompts/voice-session';
import { directFarewellAt, roleVoiceEvidence, type RoleVoiceControl } from './voice/voice-role';
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
const request = createVoiceRequest('marin', 'sdp', topics);
assert.equal(request.session.model, 'gpt-live-1');
assert.equal(request.session.delegation.type, 'client');
assert.match(JSON.stringify(request.session.input), /Halo, gue Tara/);
const agenda = JSON.parse(request.session.input[0].content[0].text.split('\n')[1]);
assert.deepEqual(agenda.map((item: { criterionId: string }) => item.criterionId), rubric.interviewIds, 'the full frozen agenda is available at startup');
assert.ok(agenda.every((item: { context: string }) => item.context === 'WORK_SCENARIO'));
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
const state: RoleVoiceControl = { slot: 0, slots: [{ topicId: demo, openedAt: origin, questionRefs: [] }] };
const playback = roleVoiceEvidence([...fragments].reverse(), delivery, state);
assert.equal(playback.evidence[0].heard, true, 'split playback and trailing speech preserve the question');
assert.equal(playback.evidence[0].questionEndMs, 1810);
assert.deepEqual(roleLiveTranscript(playback.evidence, true).map(row => [row.id, row.opportunity]),
    [['v1', 'ANSWERED'], ['v5', undefined], ['v6', undefined]]);
const cut = { ...delivery, windows: [...delivery.windows.slice(0, 2), window(1538, 1670, true)] };
assert.equal(roleVoiceEvidence(fragments, cut, state).evidence[0].heard, false, 'interrupted playback cannot verify a question');
const directDelivery = { ...delivery, firstAudioMs: 100, playbackVerified: true };
const directEvidence = (rows: Fragment[], media: NativeDelivery = directDelivery) => roleVoiceEvidence(rows, media, undefined, true).evidence;
assert.ok(directEvidence(fragments).some(row => row.id === 'v5'), 'a gap in delivery proof never erases the candidate transcript');
assert.equal(directEvidence(fragments)[0].heard, false, 'a partly played prompt cannot establish an opportunity');
const farewell: Fragment = { id: 20, speaker: 'TARA', startMs: 6200, endMs: 7600, text: 'Makasih udah cerita. Wawancara kita selesai.' };
const closingMedia = { ...directDelivery, windows: [...directDelivery.windows, window(6200, 7600)] };
assert.equal(directFarewellAt([...fragments, farewell], closingMedia), origin + 7600);
assert.equal(directFarewellAt([...fragments, farewell], { ...closingMedia, playbackVerified: false }), undefined);
assert.equal(directFarewellAt([...fragments, { ...farewell, text: 'Gue jelasin nanti setelah wawancara kita selesai.' }], closingMedia), undefined);
assert.equal(directFarewellAt([...fragments, farewell, { id: 21, speaker: 'CANDIDATE', startMs: 7700, endMs: 8100, text: 'Sebentar, gue mau nambahin.' }], closingMedia), undefined);
const specificQuestion: Fragment = { id: 22, speaker: 'TARA', startMs: 100, endMs: 1200, text: 'Waktu nunjukin solusi, langkah persiapan demo lu gimana?' };
const clarification: Fragment = { id: 23, speaker: 'CANDIDATE', startMs: 1400, endMs: 1800, text: 'Tugas yang mana ya?' };
const clarified = directEvidence([specificQuestion, clarification], { ...directDelivery, windows: [window(100, 1200)] });
assert.equal(clarified[0].heard, true);
assert.equal(clarified[0].topicId, undefined, 'the playback timeline never assigns a rubric criterion');
assert.equal(roleLiveTranscript(clarified, false, true)[0].opportunity, 'INTERRUPTED', 'a request for clarification is not an answer');
console.log('Role assessment passed: frozen criteria, CV aliases, scenarios without CV claims, Live delivery, topic limits, source integrity, cross-topic evidence, and complete-score requirements. Paid calls: 0.');
