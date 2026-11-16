import assert from 'node:assert/strict';
import { mkdtemp, appendFile, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessmentLanguageReminders } from './assessment-language';
import { attachRoleTopics, createRoleRubric, ROLE_RUBRIC_VERSION } from './role-rubric';
import { attachLiveRoleTopics, liveInterviewTopics, liveRolePackage, prepareAlignedRolePackage, prepareLiveAgenda } from './tara-live-agenda';
import { acceptLiveEvidence, liveEvidenceRequest, missingLiveOpportunity } from './taka-live-evidence';
import { prepareRoleEvidence, scoreRoleAssessment } from './taka-role-assessment';
import { roleEvidenceReferences } from './taka-role-evidence';
import { createVoiceRequest, freezeLiveVoicePrompt } from './prompts/voice-session';
import { canResumeLive, liveAssessmentTranscript, liveCompletionDecision, liveLanguageReminderDelivered, liveResumeHistory, liveTranscript, LIVE_RESUME_MINIMUM_MS, newLiveCompletion, voiceBudgetAfterClose } from './voice/voice-completion';
import type { NativeDelivery } from './voice/voice-native';
import type { Fragment } from './voice/voice.policy';
import { VoiceTranscriptJournal } from './voice/voice-transcript-journal';

const duties = ['Menggali kebutuhan pengguna', 'Menyiapkan dan memeriksa kualitas data', 'Menerapkan model AI', 'Mengevaluasi hasil model'];
const rubric = createRoleRubric({ title: 'AI Engineer', responsibilities: duties, jobSkills: [], jobLanguages: [] });
const ids = rubric.interviewIds;
const agenda = prepareLiveAgenda(rubric, null);
const packet = liveRolePackage(rubric, agenda);
const plan = attachRoleTopics({ claims: [
    { id: 'skill-0', criterionId: ids[1], skill: 'AI-assisted problem solving', statement: 'AI-assisted problem solving',
        quote: 'Keahlian · AI-assisted problem solving', question: 'Bisa ceritain satu contoh waktu lo pakai keahlian itu?',
        lineStart: 1, lineEnd: 1, scope: 'GENERAL', relevance: 'CORE' },
], limitations: [] }, rubric);
const topics = liveInterviewTopics(plan, packet, rubric);
assert.equal(topics.length, 4);
const data = topics.find(row => row.criterionId === ids[1])!;
assert.equal(data.needsCvBridge, true);
assert.equal(data.alternative, true);
assert.match(data.question, /menyiapkan dan memeriksa kualitas data/i);
assert.equal(data.workScenario, data.question);
const voice = createVoiceRequest('marin', 'mock offer', topics, 'Rani', {});
assert.equal(voice.session.model, 'gpt-live-1');
assert.equal(voice.session.store, false);
assert.equal(voice.session.delegation.type, 'client');
assert.match(voice.session.instructions, /Pamit paling awal di menit 12/u);
assert.match(voice.session.instructions, /Kebutuhan bukti di agenda berlaku untuk seluruh topik.*satu informasi baru/u);
assert.match(voice.session.input[1].content[0].text, /Bisa kita mulai\?/);
assert.match(createVoiceRequest('marin', 'mock offer', [data], 'Rani', { remainingSeconds: 100 }).session.input[1].content[0].text, /percakapan tersimpan/);

function fragment(id: number, speaker: Fragment['speaker'], startMs: number, endMs: number, text: string) {
    return { id, speaker, startMs, endMs, text };
}
const base = 1000;
const telemetry = (overrides: Partial<NativeDelivery> = {}): NativeDelivery => ({
    sequence: 8, firstAudible: base + 100, firstAudioMs: 100, playbackReadyAt: 1050, playbackVerified: true,
    windows: [{ start: base + 100, end: base + 851 }, { start: base + 2800, end: base + 3350 }], ...overrides,
});
const lateQuestion = 'Dalam contoh fitur rekomendasi yang memakai riwayat klik, gimana lo akan memeriksa kualitas data?';
const clarification = 'Contoh datanya ini apaan sih? Contohnya';
const ambiguous = 'Oh saya nggak tahu nih, kayaknya saya belum pernah bikin deh';
const explicit = 'Saya tidak bisa menjelaskan cara memeriksa kualitas data riwayat klik.';
const defaultFragments = [
    fragment(1, 'TARA', 100, 750, 'Kalau lo diminta menyiapkan data asli buat fitur AI, gimana lo akan mencari sumber datanya?'),
    fragment(2, 'CANDIDATE', 1000, 1870, clarification),
    fragment(3, 'TARA', 2800, 3580, lateQuestion),
    fragment(4, 'CANDIDATE', 3900, 4900, ambiguous),
];
const connection = (fragments = defaultFragments, delivery = telemetry(), transcriptComplete = true, id = 'voice-a', offset = 0) => ({
    id, createdAt: new Date(10_000 + offset), taraInterview: { nativeDelivery: delivery },
    transcriptComplete, closeReason: transcriptComplete ? 'CANDIDATE_ENDED' : 'CONNECTION_LOST', fragments,
});
const input = (connections = [connection()]) => prepareRoleEvidence(rubric, liveAssessmentTranscript(connections), plan);
const target = ids[1];
const criteria = (row: object) => ({ criteria: { [target]: row } });
const emptyProposal = { level: null, clarity: null, evidence: [], actionRef: null, fit: null,
    requiresQuestionContext: false, discrepancyRef: null, redirectRef: null, answerRef: null, firstAnswerRef: null, lastAnswerRef: null };
const decline = (questionRef = 'q2', answerRef = 'a2') => ({ ...emptyProposal, basis: 'DECLINED', level: 0, clarity: 0,
    questionRef, answerRef, reason: 'Kandidat belum bisa menjelaskan langkah.' });
const positive = { ...emptyProposal, basis: 'EVIDENCE', questionRef: 'q2', evidence: ['a2'], actionRef: null, requiresQuestionContext: true,
    level: 2, clarity: 2, fit: 'TRANSFERABLE', discrepancyRef: null, reason: 'Langkah sebagian sesuai dengan tugas.' };
const first = input();
const usageOpportunity = input([connection([
    fragment(11, 'TARA', 100, 750, 'Lo pernah pakai autentikasi dua faktor?'),
    fragment(12, 'CANDIDATE', 1000, 1870, 'Belum pernah. Boleh dikasih skenario?'),
    fragment(13, 'TARA', 2800, 3150, 'Apa langkah pertama untuk melindungi akses admin?'),
    fragment(14, 'CANDIDATE', 3900, 4900, 'Saya akan menyiapkan pemulihan dan menguji kredensial cadangan.'),
])]);
const usageRefs = roleEvidenceReferences(usageOpportunity);
assert.equal(usageRefs.questions.get('q1')?.text, 'Lo pernah pakai autentikasi dua faktor?');
assert.deepEqual(liveEvidenceRequest(usageOpportunity, usageRefs, [target]).data.questions.map(row => row.answers), [['a1'], ['a2']],
    'a direct mandatory-skill question and its work scenario keep separate references after Live');
const experienceRubric = createRoleRubric({ title: 'Production Editor', jobSkills: [], jobLanguages: [],
    description: 'Requirements: At least 2 years of experience using FrameMaker.' }, ROLE_RUBRIC_VERSION);
const experienceId = experienceRubric.interviewIds[0];
const experienceEvidence = prepareRoleEvidence(experienceRubric, liveAssessmentTranscript([connection([
    fragment(51, 'TARA', 100, 750, 'Lo pernah pakai FrameMaker?'),
    fragment(52, 'CANDIDATE', 1000, 1870, 'Belum pernah.'),
    fragment(53, 'TARA', 2800, 3150, 'Kalau panduan besar harus siap terbit, apa langkah lo di FrameMaker?'),
    fragment(54, 'CANDIDATE', 3900, 4900, 'Saya akan memeriksa referensi silang dan menguji ekspor sebelum menerbitkan panduan.'),
])]), { claims: [], limitations: [] });
const experienceRefs = roleEvidenceReferences(experienceEvidence);
const experienceGrade = { level: 4, clarity: 4, evidence: ['a2'], questionRef: 'q2', redirectRef: null, fit: 'TRANSFERABLE',
    requiresQuestionContext: true, discrepancyRef: null, reason: 'Langkah skenario cukup spesifik. Penggunaan aktual belum ditunjukkan.' };
assert.equal(acceptLiveEvidence(experienceEvidence, experienceRefs, { criteria: { [experienceId]: experienceGrade } }, [experienceId])
    .accepted.get(experienceId)?.level, 2);
const experienceRequest = liveEvidenceRequest(experienceEvidence, experienceRefs, [experienceId]);
assert.equal(experienceRequest.data.criteria[0].sources?.[0].minimumUsage, '2 years');
assert.match(experienceRequest.preset.instructions, /durasi minimum/u);
const firstRefs = roleEvidenceReferences(first);
assert.equal(first.turns.get('v2')?.clarification, true);
assert.equal(firstRefs.questions.get('q1')?.opportunity, 'INTERRUPTED');
assert.equal(firstRefs.questions.get('q2')?.opportunity, 'UNVERIFIED');
const rejected = acceptLiveEvidence(first, firstRefs, criteria(decline()), [target]);
assert.deepEqual(rejected.diagnostics.get(target), { questionRefs: ['v3'], reasons: ['QUESTION_NOT_CONFIRMED', 'DECLINE_NOT_EXPLICIT'] });
assert.ok(missingLiveOpportunity(rejected.diagnostics.get(target)!));
const malformed = acceptLiveEvidence(first, firstRefs, criteria({ ...decline(), redirectRef: 'q1' }), [target]);
assert.deepEqual(malformed.diagnostics.get(target)?.reasons, ['INVALID_OUTPUT']);
const request = liveEvidenceRequest(first, firstRefs, [target], rejected.diagnostics);
assert.deepEqual(request.data.questions.map(row => row.answers), [['a1'], ['a2']]);
assert.deepEqual(request.data.criteria[0].repair, ['QUESTION_NOT_CONFIRMED', 'DECLINE_NOT_EXPLICIT']);
assert.ok(request.data.questions.every(row => !('playback' in row) && !('opportunity' in row)),
    'playback telemetry cannot influence the model\'s assessment of words already supplied');
assert.equal(request.preset.schema.properties?.criteria.properties?.[target].type, 'object');
const simulated = () => input([connection(defaultFragments.map(row => row.id === 4 ? { ...row, text: explicit } : row))]);
const explicitInput = simulated();
assert.equal(acceptLiveEvidence(explicitInput, roleEvidenceReferences(explicitInput), criteria(decline()), [target]).accepted.get(target)?.level, 0,
    'the specific answer corroborates a healthy exchange even with approximate playback edges');
const contextualDecline = input([connection(defaultFragments.map(row => row.id === 4 ? { ...row,
    text: 'Saya ikut diskusi sebagai pengamat. Saya tidak bisa menjelaskan bagaimana mengerjakan tugas itu.' } : row))]);
const contextualRefs = roleEvidenceReferences(contextualDecline);
const declineRef = [...contextualRefs.answers].find(([, row]) => row.text.includes('tidak bisa menjelaskan'))?.[0];
assert.ok(declineRef);
assert.equal(acceptLiveEvidence(contextualDecline, contextualRefs, criteria(decline('q2', declineRef)), [target]).accepted.get(target)?.level, 0);
const precedingEvidence = input([connection(defaultFragments.map(row => row.id === 4 ? { ...row,
    text: 'Saya memeriksa duplikat pada riwayat klik. Saya tidak bisa menjelaskan cara memeriksa kualitas data riwayat klik.' } : row))]);
const precedingRefs = roleEvidenceReferences(precedingEvidence);
const precedingRef = [...precedingRefs.answers].find(([, row]) => row.text.includes('tidak bisa menjelaskan'))?.[0];
assert.ok(precedingRef);
assert.ok(!acceptLiveEvidence(precedingEvidence, precedingRefs, criteria(decline('q2', precedingRef)), [target]).accepted.size,
    'an explicit phrase does not erase concrete evidence from the same turn');
const interrupted = input([connection(defaultFragments, telemetry({ windows: [{ start: base + 2800, end: base + 3200, interrupted: true }] }), false)]);
assert.equal(acceptLiveEvidence(interrupted, roleEvidenceReferences(interrupted), criteria(decline()), [target]).accepted.size, 0);
const redirected = input([connection([
    defaultFragments[0], fragment(2, 'CANDIDATE', 1000, 1870, 'Saya bermain bulu tangkis setiap akhir pekan.'),
    defaultFragments[2], fragment(4, 'CANDIDATE', 3900, 4900, 'Saya membantu turnamen bulu tangkis di kampus.'),
], telemetry({ windows: [{ start: base + 100, end: base + 850 }, { start: base + 2800, end: base + 3650 }] }))]);
const afterRedirection = { ...emptyProposal, level: 0, clarity: 0, basis: 'AFTER_REDIRECTION', questionRef: 'q1', firstAnswerRef: 'a1',
    redirectRef: 'q2', lastAnswerRef: 'a2', reason: 'Kandidat tetap membahas hal lain setelah diarahkan kembali.' };
const redirectRefs = roleEvidenceReferences(redirected);
assert.equal(acceptLiveEvidence(redirected, redirectRefs, criteria(afterRedirection), [target]).accepted.get(target)?.level, 0);
const redirectGrades = acceptLiveEvidence(redirected, redirectRefs, criteria(afterRedirection), [target]).accepted;
const redirectReport = scoreRoleAssessment(redirected, redirectGrades, 80, false, undefined, { unavailable: new Set() });
assert.deepEqual(redirectReport.result.roleAssessment?.criteria.find(row => row.criterionId === target)?.evidence.map(row => row.questionRef),
    ['v1', 'v3'], 'each quote in a redirected answer is displayed with its own question');
assert.ok(!acceptLiveEvidence(redirected, redirectRefs, criteria({ ...afterRedirection, lastAnswerRef: 'a1' }), [target]).accepted.size);
const referenceGrade = { level: 0, clarity: 0, evidence: ['a2'], questionRef: 'q2', redirectRef: null, fit: null,
    requiresQuestionContext: false, discrepancyRef: null, reason: 'Kandidat menyatakan belum bisa menjelaskan langkah.' };
assert.equal(acceptLiveEvidence(simulated(), roleEvidenceReferences(simulated()), criteria(referenceGrade), [target]).accepted.get(target)?.level, 0);
assert.equal(acceptLiveEvidence(simulated(), roleEvidenceReferences(simulated()), criteria({ ...referenceGrade, questionRef: 'a2' }), [target])
    .accepted.get(target)?.questionRef, 'v3', 'a verified question window can recover a mistyped question pointer for an explicit decline');
const withoutOpportunity = acceptLiveEvidence(interrupted, roleEvidenceReferences(interrupted), criteria(referenceGrade), [target]);
assert.ok(!withoutOpportunity.accepted.size);
assert.ok(withoutOpportunity.diagnostics.get(target)?.reasons.includes('QUESTION_INTERRUPTED'));
assert.equal(acceptLiveEvidence(redirected, redirectRefs, criteria({ ...referenceGrade, questionRef: 'q1', redirectRef: 'q2',
    evidence: ['a1', 'a2'] }), [target]).accepted.get(target)?.level, 0);
const finishedVerb = 'Saya mengecek kelengkapan dan format data riwayat klik, lalu mencatat entri duplikat sebelum membuat dataset.';
const other = connection([fragment(9, 'TARA', 100, 750, lateQuestion), fragment(10, 'CANDIDATE', 1000, 1880, finishedVerb)],
    telemetry(), true, 'voice-b', 10_000);
const recovered = input([connection(), other]);
const recoveredRefs = roleEvidenceReferences(recovered);
assert.deepEqual(liveTranscript([connection(), other]).map(row => row.id), ['v1', 'v2', 'v3', 'v4', 'v9', 'v10']);
assert.equal(acceptLiveEvidence(recovered, recoveredRefs, criteria({ ...positive, evidence: ['a3'] }), [target]).accepted.size, 0,
    'an answer in a new connection cannot fill an earlier question window');
const valid = acceptLiveEvidence(recovered, recoveredRefs, criteria({ ...positive, questionRef: 'q3', evidence: ['a3'], actionRef: 'a999' }), [target]);
assert.equal(valid.accepted.get(target)?.level, 2, 'an optional action reference does not discard independently valid level 2 evidence');
const sufficientWithoutQuestion = acceptLiveEvidence(recovered, recoveredRefs, criteria({ level: null, clarity: null,
    evidence: [], questionRef: null, redirectRef: null, fit: null, requiresQuestionContext: false, discrepancyRef: null,
    reason: 'Belum cukup bukti.' }), [target]);
assert.deepEqual(sufficientWithoutQuestion.diagnostics.get(target)?.reasons, ['INSUFFICIENT_WITH_ANSWER'],
    'a bare insufficient result cannot bypass review when the interview contains possible evidence');
const answerToThirdQuestion = { ...positive, questionRef: 'q3', evidence: ['a3'] };
assert.equal(acceptLiveEvidence(recovered, recoveredRefs, criteria({ ...answerToThirdQuestion,
    answerRef: 'a999', firstAnswerRef: 'a999', lastAnswerRef: 'a999', redirectRef: 'q999' }), [target]).accepted.get(target)?.level, 2,
    'irrelevant zero-grade references do not discard a valid quote');
assert.deepEqual(acceptLiveEvidence(recovered, recoveredRefs, criteria({ ...answerToThirdQuestion, level: 0 }), [target]).diagnostics.get(target)?.reasons,
    ['INVALID_OUTPUT']);
const explicitRefs = roleEvidenceReferences(explicitInput);
assert.deepEqual(acceptLiveEvidence(explicitInput, explicitRefs, criteria({ ...decline(), level: null }), [target]).diagnostics.get(target)?.reasons,
    ['INVALID_OUTPUT']);
const onlyGrade = scoreRoleAssessment(recovered, valid.accepted, 43.8, false, undefined, {
    unavailable: new Set(), includePartial: false, diagnostics: rejected.diagnostics,
});
assert.equal(onlyGrade.finalScore, null);
assert.equal(onlyGrade.result.roleAssessment?.partial, undefined);
const sceneWithDirectEvidence = new Map(ids.map(id => [id, { ...valid.accepted.get(target)!, level: id === target ? 0 : 2, clarity: id === target ? 0 : 2 }]));
assert.equal(scoreRoleAssessment(recovered, sceneWithDirectEvidence, 43.8, false).finalScore, 39.4);

const initial = newLiveCompletion(), now = 20_000, deadline = new Date(900_000);
const options = { finalScore: null, cvMissing: false, deadline, replacementUsed: false, interrupted: true,
    assessmentFailed: false, missingCriterionIds: [target], now };
const pending = liveCompletionDecision(initial, options);
assert.equal(pending.status, 'RESUMABLE');
assert.ok(canResumeLive(pending, deadline, now));
assert.ok(!canResumeLive(pending, deadline, +deadline));
assert.equal(liveCompletionDecision(initial, { ...options, now: +deadline }).status, 'INTERRUPTED');
assert.equal(liveCompletionDecision(initial, { ...options, replacementUsed: true }).status, 'INTERRUPTED');
assert.equal(liveCompletionDecision(initial, { ...options, assessmentFailed: true }).status, 'REVIEW_REQUIRED');
assert.equal(liveCompletionDecision(initial, { ...options, finalScore: 39.4 }).status, 'COMPLETE');
assert.deepEqual(voiceBudgetAfterClose(7 * 60_000, 8 * 60_000), { usedVoiceMs: 900_000, remainingVoiceMs: 0 });
assert.deepEqual(voiceBudgetAfterClose(0, 0), { usedVoiceMs: 15_000, remainingVoiceMs: 885_000 });
const almostExhausted = liveCompletionDecision({ ...initial, remainingVoiceMs: LIVE_RESUME_MINIMUM_MS - 1 }, options);
assert.equal(almostExhausted.status, 'INTERRUPTED');
assert.equal(almostExhausted.reason, 'TIME_LIMIT');
const roomForClose = liveCompletionDecision({ ...initial, remainingVoiceMs: LIVE_RESUME_MINIMUM_MS }, options);
assert.ok(canResumeLive(roomForClose, null, now));
const splitQuestion = connection([
    fragment(21, 'TARA', 100, 300, 'Bayangin lo harus membersihkan data transaksi.'),
    fragment(22, 'TARA', 320, 650, 'Langkah pertama yang lo ambil apa?'),
    fragment(23, 'CANDIDATE', 1000, 1500, finishedVerb),
]);
const splitEvidence = liveAssessmentTranscript([splitQuestion]);
assert.equal(splitEvidence[0].question, true);
assert.equal(splitEvidence[0].playback, 'CONFIRMED', 'a complete question ending in apa is not interrupted');
const overlap = connection([
    fragment(30, 'TARA', 100, 750, 'Lo pernah pakai autentikasi dua faktor?'),
    fragment(31, 'CANDIDATE', 2200, 3000, 'Saya menguji bahwa kode yang kedaluwarsa'),
    fragment(32, 'TARA', 3000, 3750, 'Berikutnya, apa langkah lo saat menangani insiden produksi?'),
    fragment(33, 'CANDIDATE', 3200, 3400, ' ditolak.'),
    fragment(34, 'CANDIDATE', 4400, 5350, 'Saya memeriksa log dan mengembalikan rilis terakhir.'),
]);
const overlapInput = input([overlap]);
assert.deepEqual([...roleEvidenceReferences(overlapInput).answers.values()].map(row => row.text), [
    'Saya menguji bahwa kode yang kedaluwarsa ditolak.',
    'Saya memeriksa log dan mengembalikan rilis terakhir.',
], 'retain a trailing word with the unfinished answer and keep the next answer separate');
assert.deepEqual(liveResumeHistory([overlap]).map(row => row.text), liveTranscript([overlap]).map(row => row.text.trim()));
const history = liveResumeHistory([connection(), splitQuestion]);
assert.equal(history.at(-1)?.text, finishedVerb);
assert.deepEqual(history.find(turn => turn.text === lateQuestion), {
    speaker: 'TARA', text: lateQuestion, playbackUnverified: true,
}, 'resume distinguishes unverified playback from the text of a captured question');
assert.deepEqual(history.find(turn => turn.text === clarification), { speaker: 'CANDIDATE', text: clarification });
assert.deepEqual(history[0], { speaker: 'TARA', text: defaultFragments[0].text }, 'verified playback needs no qualification');
const unansweredQuestion = 'Kapan lo pernah menguji autentikasi dua faktor?';
const finalUnansweredQuestion = 'Apa langkah lo buat mengecek autentikasi itu?';
const unansweredLeg = connection([...defaultFragments, fragment(41, 'TARA', 5600, 6900, unansweredQuestion),
    fragment(42, 'TARA', 9050, 10_200, finalUnansweredQuestion)], telemetry(), false);
const followingLeg = connection([fragment(43, 'CANDIDATE', 400, 800, 'Oke, lanjut.')], telemetry(), true, 'voice-b');
const recordedQuestions = liveAssessmentTranscript([unansweredLeg, followingLeg]);
for (const text of [unansweredQuestion, finalUnansweredQuestion])
    assert.equal(recordedQuestions.find(turn => turn.text === text)?.playback, 'UNKNOWN');
assert.deepEqual(liveResumeHistory([unansweredLeg, followingLeg]).map(turn => turn.text),
    [...defaultFragments.map(row => row.text), 'Oke, lanjut.'], 'both unanswered and unverified questions stay out of the shared history');
for (const language of ['id', 'en'] as const) {
    const reminder = assessmentLanguageReminders[language];
    const split = reminder.indexOf(' ');
    const fragments = [...defaultFragments, fragment(44, 'TARA', 23_600, 23_800, reminder.slice(0, split)),
        fragment(45, 'TARA', 23_800, 25_800, reminder.slice(split))];
    const reminderWindow = { start: base + 23_858, end: base + 26_241 };
    const heard = connection(fragments, telemetry({ windows: [...telemetry().windows, reminderWindow] }));
    assert.equal(liveAssessmentTranscript([heard]).at(-1)?.playback, 'HEALTHY_UNVERIFIED');
    assert.ok(!liveResumeHistory([heard]).some(turn => turn.text === reminder));
    assert.equal(liveLanguageReminderDelivered([heard, followingLeg], language), true,
        'a native transcript estimate ahead of playback does not cause the reminder to be repeated');
    const delayedWindow = { start: base + 24_067, end: base + 26_355 };
    assert.equal(liveLanguageReminderDelivered([connection(fragments, telemetry({ windows: [delayedWindow] }))], language), true,
        'a later complete playback window carries the reminder across reconnection');
    assert.equal(liveLanguageReminderDelivered([heard], language === 'id' ? 'en' : 'id'), false);
    for (const window of [{ ...reminderWindow, interrupted: true }, { ...reminderWindow, end: base + 24_200 }]) {
        assert.equal(liveLanguageReminderDelivered([connection(fragments, telemetry({ windows: [window] }))], language), false);
    }
    assert.equal(liveLanguageReminderDelivered([connection(fragments,
        telemetry({ playbackVerified: false, windows: [reminderWindow] }))], language), false);
    assert.equal(liveLanguageReminderDelivered([connection(fragments.map(row => row.id >= 44 ? { ...row, speaker: 'CANDIDATE' } : row),
        telemetry({ windows: [reminderWindow] }))], language), false);
    const prompt = freezeLiveVoicePrompt('marin', language);
    const reconnect = createVoiceRequest('marin', 'offer', topics, 'Rani', { prompt, remainingSeconds: 480,
        history: liveResumeHistory([heard]), languageReminderDelivered: liveLanguageReminderDelivered([heard], language) });
    const brief = JSON.parse(reconnect.session.input[0].content[0].text.split('\n')[1]);
    assert.equal(brief.languageReminderDelivered, true);
    assert.ok(!brief.previousConversation.some((turn: { text: string }) => turn.text === reminder));
}
const continued = createVoiceRequest('marin', 'offer', topics, 'Rani', { remainingSeconds: 480, history,
    assessedCriterionIds: [ids[0]], missingCriterionIds: ids.slice(1) });
const resumeData = JSON.parse(continued.session.input[0].content[0].text.split('\n')[1]);
const initialTopics = JSON.parse(voice.session.input[0].content[0].text.split('\n')[1]).topics;
assert.deepEqual(resumeData.previousConversation, history);
assert.deepEqual(resumeData.topics, initialTopics.slice(1), 'the resume agenda leads with the unresolved competencies');
assert.equal(resumeData.remainingSeconds, 480);
assert.equal(resumeData.elapsedSeconds, 420);
assert.match(continued.session.instructions, /playbackUnverified/u);
assert.match(continued.session.instructions, /Kebutuhan bukti di agenda berlaku untuk seluruh topik.*satu informasi baru/u);
assert.match(continued.session.input[1].content[0].text, /tunggu jawaban sebelum minta contoh/u);
assert.deepEqual(resumeData.assessedCriterionIds, [ids[0]]);
assert.deepEqual(resumeData.missingCriterionIds, ids.slice(1));

const mismatchedResume = createVoiceRequest('marin', 'offer', topics, 'Rani', { remainingSeconds: 180, history,
    assessedCriterionIds: ids, missingCriterionIds: ['not-in-the-frozen-rubric'] });
assert.deepEqual(JSON.parse(mismatchedResume.session.input[0].content[0].text.split('\n')[1]).topics, initialTopics,
    'an unrelated missing reference does not erase the frozen agenda');

const partialResume = createVoiceRequest('marin', 'offer', topics, 'Rani', { remainingSeconds: 180, history,
    assessedCriterionIds: ids.slice(1, -1), missingCriterionIds: ids.slice(-1) });
assert.deepEqual(JSON.parse(partialResume.session.input[0].content[0].text.split('\n')[1]).topics,
    [initialTopics.at(-1), initialTopics[0]], 'explicitly pending comes first and unclassified topics remain available');

const resumeQuestion = 'Apa yang lo periksa sebelum memulihkan data?';
const previousExchanges = Array.from({ length: 30 }, (_, index) => [
    { speaker: 'TARA', text: `Apakah contoh ${index + 1} sudah diuji?` },
    { speaker: 'CANDIDATE', text: `Contoh ${index + 1} berhasil. ${'Saya lakukan pengujian ulang bersama tim region 日本. '.repeat(16)}` },
]).flat();
const longHistory = [...previousExchanges, { speaker: 'TARA', text: resumeQuestion, interrupted: true }, {
    speaker: 'CANDIDATE', cutShort: true,
    text: `Gue bandingkan dengan data cadangan. ${'Ada bukti akurat "99%" dan catatan pengujian region 日本. '.repeat(200)}Pemeriksaan berikutnya perlu dijelaskan…`,
}];
const longRequest = createVoiceRequest('marin', 'offer', topics, 'Rani', { remainingSeconds: 480, history: longHistory });
const startupText = longRequest.session.input[0].content[0].text;
const longResume = JSON.parse(startupText.split('\n')[1]);
assert.ok(Buffer.byteLength(startupText + longRequest.session.input[1].content[0].text) <= 7600);
assert.equal(longResume.historyExcerpt, true);
assert.deepEqual(longResume.topics, initialTopics, 'without evaluated coverage, all frozen topics remain available');
assert.deepEqual(longResume.previousConversation.slice(0, 2), previousExchanges.slice(0, 2), 'keep early conversation, not just the tail');
assert.deepEqual(longResume.previousConversation.at(-2), { speaker: 'TARA', text: resumeQuestion, interrupted: true });
assert.equal(longResume.previousConversation.at(-1)?.cutShort, true);
assert.equal(longResume.previousConversation.at(-1)?.excerpt, true);
assert.match(longResume.previousConversation.at(-1)?.text, /^Gue bandingkan[\s\S]+Pemeriksaan berikutnya perlu dijelaskan…$/u);

const earlyLongAnswer = { speaker: 'CANDIDATE',
    text: `Gue cek mutasi produk terhadap pesanan pemasok. ${'Gue catat perubahan per lot untuk audit. '.repeat(250)}Terakhir gue cocokkan jumlah fisik sebelum tutup.` };
const longEarlyRequest = createVoiceRequest('marin', 'offer', topics, 'Rani', {
    remainingSeconds: 480, history: [longHistory[0], earlyLongAnswer, ...longHistory.slice(2)],
});
const longEarlyText = longEarlyRequest.session.input[0].content[0].text;
const longEarlyTurns = JSON.parse(longEarlyText.split('\n')[1]).previousConversation;
assert.ok(Buffer.byteLength(longEarlyText + longEarlyRequest.session.input[1].content[0].text) <= 7600);
assert.deepEqual(longEarlyTurns[0], longHistory[0], 'a very long early reply preserves its question');
assert.equal(longEarlyTurns[1].excerpt, true);
assert.match(longEarlyTurns[1].text, /^Gue cek mutasi produk[\s\S]+cocokkan jumlah fisik sebelum tutup\.$/u);
assert.deepEqual(longEarlyTurns.slice(-2), longResume.previousConversation.slice(-2));

const longSkillJob = { title: 'Production Editor', jobLanguages: [], jobSkills: Array.from({ length: 10 }, (_, index) => ({
    skill: { name: `Pemeriksaan materi produksi pada tahap ${index + 1}` }, isRequired: true,
})) };
const longSkillPacket = prepareAlignedRolePackage(createRoleRubric(longSkillJob, ROLE_RUBRIC_VERSION), null);
const longSkillPlan = attachLiveRoleTopics({ claims: [], limitations: [] }, longSkillPacket.roleRubric, longSkillPacket.liveAgenda);
const longSkillTopics = liveInterviewTopics(longSkillPlan, longSkillPacket, longSkillPacket.roleRubric);
const wideBrief = createVoiceRequest('marin', 'offer', longSkillTopics, 'Rani', { remainingSeconds: 480, history: longHistory });
const wideText = wideBrief.session.input[0].content[0].text;
const wideInput = JSON.parse(wideText.split('\n')[1]);
assert.deepEqual(wideInput.topics.map((row: { criterionId: string }) => row.criterionId), longSkillTopics.map(row => row.criterionId));
assert.deepEqual(wideInput.topics.map((row: { requiredSkill: unknown }) => row.requiredSkill), longSkillTopics.map(row => row.requiredSkill));
assert.deepEqual(wideInput.topics.map((row: { question: string }) => row.question), longSkillTopics.map(row => row.question));
assert.deepEqual(wideInput.topics.map((row: { workScenario: string }) => row.workScenario), longSkillTopics.map(row => row.workScenario));
assert.ok(Buffer.byteLength(wideText + wideBrief.session.input[1].content[0].text) <= 7600);
assert.equal(wideInput.previousConversation?.[0]?.text, previousExchanges[0].text, 'a large agenda must leave room for early evidence');
assert.equal(wideInput.previousConversation?.at(-2)?.text, resumeQuestion, 'preserve the last exchange alongside all mandatory topics');

const denseTopics = longSkillTopics.map((topic, index) => ({ ...topic,
    requirementRef: `${topic.label} sebelum materi masuk pengarsipan dan persetujuan pengiriman ke pihak pencetak.`,
    why: `Pemeriksaan pada tahap ${index + 1} menentukan apakah file produksi siap dikirim. Kesalahan pada tahap ini dapat membuat materi harus dicetak ulang.`,
    minimumEvidence: `Satu keputusan pribadi saat menemukan perbedaan antara bukti cetak dan spesifikasi yang disetujui pada tahap ${index + 1}.`,
    ...(index < 4 ? { cvQuote: `Di tahap ${index + 1}, saya memeriksa bukti cetak majalah bersama editor produksi. Saya membandingkan tabel spesifikasi dari percetakan dengan file yang diterima, mendokumentasikan perbedaannya, dan mengirim laporan untuk ditinjau sebelum persetujuan pengiriman.`,
        alternative: false, requiredSkill: { ...topic.requiredSkill!, cvEvidence: 'CV_EXAMPLE' as const } } : {}),
}));
const denseBrief = createVoiceRequest('marin', 'offer', denseTopics, 'Rani', { remainingSeconds: 480, history: longHistory,
    assessedCriterionIds: denseTopics.slice(0, 4).map(topic => topic.criterionId) });
const denseText = denseBrief.session.input[0].content[0].text;
const denseInput = JSON.parse(denseText.split('\n')[1]);
assert.ok(Buffer.byteLength(denseText + denseBrief.session.input[1].content[0].text) <= 7600, 'verbose agenda and prior conversation fit the startup budget');
assert.deepEqual(denseInput.topics.map((row: { criterionId: string }) => row.criterionId), denseTopics.map(row => row.criterionId));
assert.deepEqual(denseInput.topics.map((row: { requiredSkill: unknown }) => row.requiredSkill), denseTopics.map(row => row.requiredSkill));
assert.deepEqual(denseInput.topics.map((row: { question: string }) => row.question), denseTopics.map(row => row.question));
assert.deepEqual(denseInput.topics.map((row: { workScenario: string }) => row.workScenario), denseTopics.map(row => row.workScenario));
assert.equal(denseInput.previousConversation?.[0]?.text, previousExchanges[0].text);
assert.equal(denseInput.previousConversation?.at(-2)?.text, resumeQuestion);
assert.equal(denseInput.previousConversation?.at(-1)?.cutShort, true);

const contactHistory = [{ speaker: 'CANDIDATE', text: 'Saya cek data. Hubungi kandidat@example.org atau +62 813 1234 5678.' }];
const privateResume = createVoiceRequest('marin', 'offer', topics, 'Rani', { remainingSeconds: 480, history: contactHistory });
assert.deepEqual(JSON.parse(privateResume.session.input[0].content[0].text.split('\n')[1]).previousConversation, [
    { speaker: 'CANDIDATE', text: 'Saya cek data. Hubungi [email] atau [kontak].' },
]);

async function verifyJournal() {
    const directory = await mkdtemp(join(tmpdir(), 'talentio-voice-journal-'));
    const journal = new VoiceTranscriptJournal(directory);
    try {
        const fragment = { eventId: 'synthetic', speaker: 'CANDIDATE', text: finishedVerb, startMs: 100, endMs: 700 };
        await journal.append('voice-1', [fragment]);
        await appendFile(join(directory, 'voice-1.jsonl'), '{"incomplete');
        const restored = new VoiceTranscriptJournal(directory);
        assert.deepEqual(await restored.batches('voice-1'), { rows: [[fragment]], gap: true });
        const afterRestart = { ...fragment, eventId: 'new-after-restart' };
        await restored.append('voice-1', [afterRestart]);
        assert.deepEqual(await restored.batches('voice-1'), { rows: [[fragment], [afterRestart]], gap: true });
        await appendFile(join(directory, 'voice-1.closed'), '420000');
        assert.deepEqual(await restored.readClosure('voice-1'), { billedVoiceMs: 420000 });
        await journal.recordProviderId('voice-2', 'live_retry-handle');
        assert.equal(await restored.readProviderId('voice-2'), 'live_retry-handle');
        assert.equal(await restored.readClosure('voice-2'), undefined);
        assert.deepEqual((await restored.ids()).sort(), ['voice-1', 'voice-2']);
        await restored.remove('voice-1', '.closed');
        await restored.remove('voice-1');
        await restored.remove('voice-2', '.provider');
        assert.deepEqual(await restored.ids(), []);
    } finally {
        await journal.remove('voice-1', '.closed');
        await journal.remove('voice-1');
        await journal.remove('voice-2', '.provider');
        await rmdir(directory);
    }
}
void verifyJournal().then(() => {
    console.log('Tara Live completion passed: coverage, cumulative time, playback evidence, score states and restart-safe transcript journal. Paid calls: 0.');
}).catch(error => { console.error(error); process.exitCode = 1; });
