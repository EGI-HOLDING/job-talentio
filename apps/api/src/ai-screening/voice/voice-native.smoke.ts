import assert from 'node:assert/strict';
import { nativeCoverage, nativeInterview, nativeVoiceTurns, recordMedia, topicForQuestion, type NativeDelivery } from './voice-native';
import { createVoiceRequest } from '../prompts/voice-session';
import type { TaraTopic } from '../tara-interview';

const topics: TaraTopic[] = ['Node.js', 'SQL', 'Python', 'C++'].map((label, index) => ({
    id: 'skill-' + index, criterionId: 'task', label, question: `Soal ${label}, apa yang lu kerjain sendiri?`, alternative: false,
}));
const request = createVoiceRequest('marin', 'synthetic', topics);
assert.equal(request.session.model, 'gpt-live-1');
assert.deepEqual(request.session.delegation, { type: 'client' });
assert.deepEqual(request.session.client.data_channel.allowed_client_events, []);
assert.equal(request.session.input[0].role, 'user');
assert.equal(topicForQuestion('Soal C, apa yang lu kerjain?', topics), undefined);
assert.equal(topicForQuestion('Soal C++, apa yang lu kerjain?', topics)?.id, 'skill-3');
assert.equal(topicForQuestion('Soal Node JS, apa yang lu kerjain?', topics)?.id, 'skill-0');
assert.equal(topicForQuestion('Soal SQL dan Python, apa yang lu kerjain?', topics), undefined);

const first = 15_000;
const media: NativeDelivery = { sequence: 0, windows: [] };
assert.equal(recordMedia(media, 'READY', 1, first - 500), true);
assert.equal(recordMedia(media, 'AUDIBLE', 2, first), true);
assert.equal(recordMedia(media, 'QUIET', 3, first + 1200), true);
assert.equal(recordMedia(media, 'INTERRUPTED', 2, first + 1500), false);
recordMedia(media, 'AUDIBLE', 4, first + 5100);
recordMedia(media, 'INTERRUPTED', 5, first + 5600);
const f = (id: number, speaker: string, startMs: number, endMs: number, text: string) => ({ id, speaker, startMs, endMs, text });
const turns = nativeVoiceTurns([
    f(1, 'TARA', 100, 600, 'Soal Node.js,'),
    f(2, 'CANDIDATE', 1450, 1800, 'Saya menulis endpoint.'),
    f(3, 'TARA', 620, 1100, ' bagian mana yang lu kerjain sendiri?'),
    f(4, 'TARA', 2600, 2750, 'Oke.'),
    f(5, 'CANDIDATE', 3650, 4600, ' Lalu saya uji dengan data sintetis.'),
    f(6, 'TARA', 5200, 6400, 'Soal SQL, apa yang lu kerjain sendiri?'),
    f(7, 'CANDIDATE', 7000, 7500, 'Saya menulis query.'),
]);
assert.equal(turns[0].text, 'Soal Node.js, bagian mana yang lu kerjain sendiri?');
const projection = nativeInterview(topics, turns, media, 30_000, true);
assert.equal(projection.origin, first - 100);
assert.deepEqual(projection.evidenceTurns.map(turn => turn.id), ['v1', 'v2', 'v5']);
assert.deepEqual(projection.progress.topics[0].note.answerRefs, ['v2', 'v5']);
assert.equal(projection.progress.topics[1].note.outcome, 'TECHNICAL_INTERRUPTION');
assert.equal(nativeCoverage(topics, turns, media, 180_000)?.id, 'skill-1');
assert.equal(nativeCoverage(topics, turns, media, 1000), undefined);
assert.equal(nativeInterview(topics, turns, { sequence: 0, windows: [] }, 30_000, false).progress.questions, 0);
const alternative = { ...topics[0], id: 'outside-cv', alternative: true };
assert.equal(topicForQuestion('Pernah ada kegiatan yang mirip dengan tugas utama ini?', [alternative])?.id, 'outside-cv');
assert.equal(topicForQuestion('Lu sudah siap?', [alternative]), undefined);
console.log('Tara Native: one model, delivery proof, stale telemetry, out-of-order fragments, interruption, coverage and alternative topic passed.');
