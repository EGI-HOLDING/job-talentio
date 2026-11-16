import assert from 'node:assert/strict';
import { voiceEvidence,voiceOpportunities } from './voice-evidence';
import { directFarewellAt, ROLE_VOICE_CLOSING_TEXT, ROLE_VOICE_EN_CLOSING_TEXT } from './voice-role';
import { createVoiceRequest, freezeLiveVoicePrompt } from '../prompts/voice-session';
import { assessmentLanguageReminders } from '../assessment-language';
const turns=[
 {id:'q1',speaker:'TARA',text:'Proyek API apa yang lu kerjakan?',startMs:0,endMs:1000,fragmentIds:[1]},
 {id:'a1',speaker:'CANDIDATE',text:'Saya membuat API.',startMs:1500,endMs:2500,fragmentIds:[2]},
 {id:'q2',speaker:'TARA',text:'Bagian lu sendiri dan hasilnya?',startMs:3000,endMs:4000,fragmentIds:[3]},
 {id:'a2',speaker:'CANDIDATE',text:'Saya membuat endpoint, hasilnya latensi turun.',startMs:5000,endMs:6000,fragmentIds:[4]},
 {id:'q3',speaker:'TARA',text:'Sekarang pengalaman manajemen tim?',startMs:7000,endMs:8000,fragmentIds:[5]},
 {id:'a3',speaker:'CANDIDATE',text:'Saya memimpin tim.',startMs:9000,endMs:10000,fragmentIds:[6]},
];
assert.deepEqual(voiceOpportunities(turns),[{questionRef:'q1',answerRefs:['a1']},{questionRef:'q2',answerRefs:['a2']},{questionRef:'q3',answerRefs:['a3']}]);
assert.equal(voiceEvidence(turns,[{questionRef:'q1',answerRefs:['a1']},{questionRef:'q2',answerRefs:['a2']}]).length,2,'initial and follow-up evidence retained');
assert.throws(()=>voiceEvidence(turns,[{questionRef:'q1',answerRefs:['a3']}]),/UNGROUNDED/,'later topic cannot be cited as answer to initial question');
assert.throws(()=>voiceEvidence(turns,[{questionRef:'q2',answerRefs:['a1']}]),/UNGROUNDED/,'earlier answer cannot be cited for a later question');
assert.throws(()=>voiceEvidence(turns,[{questionRef:'a1',answerRefs:['a2']}]),/OPPORTUNITY/);
assert.throws(()=>voiceEvidence(turns,[{questionRef:'q1',answerRefs:['a1','a1']}]),/UNGROUNDED/);
const farewell = { id: 1, speaker: 'TARA', startMs: 100, endMs: 850,
 text: 'Oke, makasih udah cerita. Wawancara kita selesai.' };
const playback = { sequence: 2, firstAudioMs: 100, firstAudible: 1000, playbackVerified: true,
 windows: [{ start: 990, end: 1850 }] };
assert.equal(directFarewellAt([farewell], playback), 1750);
assert.equal(directFarewellAt([{ ...farewell, text: 'Gimana kalau klien bilang “wawancara kita selesai”?' }], playback), undefined);
assert.equal(directFarewellAt([farewell, { id: 2, speaker: 'CANDIDATE', text: 'Tunggu.', startMs: 840, endMs: 950 }], playback), undefined);
assert.equal(directFarewellAt([farewell], { ...playback, playbackVerified: false }), undefined);
const englishFarewell = { ...farewell, text: ROLE_VOICE_EN_CLOSING_TEXT };
assert.equal(directFarewellAt([englishFarewell], playback, 100, undefined, 'en'), 1750);
assert.equal(directFarewellAt([englishFarewell], playback, 101, undefined, 'en'), undefined);
assert.equal(directFarewellAt([englishFarewell], playback, 0, 1050, 'en'), undefined);
assert.equal(directFarewellAt([englishFarewell], playback, 0, undefined, 'id'), undefined);
assert.equal(directFarewellAt([{ ...englishFarewell, text: 'What if a manager says our interview is complete?' }], playback, 0, undefined, 'en'), undefined);
assert.equal(directFarewellAt([{ ...englishFarewell, text: 'Thanks. This concludes our interview.' }], playback, 0, undefined, 'en'), 1750);
assert.equal(directFarewellAt([{ ...englishFarewell, text: 'A manager might say “This concludes our interview.”' }], playback, 0, undefined, 'en'), undefined);
assert.equal(directFarewellAt([{ ...farewell, text: 'Terima kasih. Wawancara kita selesai.' }], playback), 1750);
assert.equal(directFarewellAt([{ ...farewell, text: 'Wawancara kita selesai. Eh, ada satu hal lagi.' }], playback), undefined);
for (const language of ['id', 'en'] as const) {
 const closing = language === 'en' ? englishFarewell.text : farewell.text;
 const split = closing.indexOf(' ');
 const delayed = [{ ...farewell, startMs: 30_600, endMs: 30_800, text: closing.slice(0, split) },
  { ...farewell, id: 2, startMs: 30_800, endMs: 32_000, text: closing.slice(split) }];
 const played = { start: 31_819, end: 33_579 };
 const confirmed = { ...playback, windows: [played] };
 assert.equal(directFarewellAt(delayed, confirmed, 0, 31_300, language), 32_900);
 assert.equal(directFarewellAt(delayed, { ...confirmed, open: played.start }, 0, 31_300, language), undefined);
 assert.equal(directFarewellAt(delayed, { ...confirmed, windows: [{ ...played, interrupted: true }] }, 0, 31_300, language), undefined);
 assert.equal(directFarewellAt(delayed, { ...confirmed, windows: [{ start: 31_967, end: 33_366 }] }, 0, 31_300, language), undefined);
 assert.equal(directFarewellAt(delayed, { ...confirmed, windows: [{ start: 31_967, end: 33_367 }] }, 0, 31_300, language), 32_900);
 assert.equal(directFarewellAt(delayed, { ...confirmed, windows: [{ ...played, start: 32_151, end: 33_700 }] }, 0, 31_300, language), undefined);
 assert.equal(directFarewellAt(delayed, { ...confirmed, windows: [{ ...played, end: 32_549 }] }, 0, 31_300, language), undefined);
 assert.equal(directFarewellAt(delayed, confirmed, 0, 31_499, language), 32_900);
 assert.equal(directFarewellAt(delayed, confirmed, 0, 31_500, language), undefined);
 const overlap = { ...farewell, id: 3, speaker: 'CANDIDATE', text: 'No more details.', startMs: 29_000, endMs: 30_800 };
 assert.equal(directFarewellAt([...delayed, overlap], confirmed, 0, 31_300, language), 32_900);
 assert.equal(directFarewellAt([...delayed, overlap], confirmed, 0, undefined, language), undefined);
 assert.equal(directFarewellAt([...delayed, overlap], confirmed, 0, 31_500, language), undefined);
 assert.equal(directFarewellAt([...delayed, { ...overlap, endMs: 30_951 }], confirmed, 0, 31_300, language), undefined);
 const canonical = language === 'en' ? ROLE_VOICE_EN_CLOSING_TEXT : ROLE_VOICE_CLOSING_TEXT;
 const firstClosingWord = canonical.indexOf(' ');
 const recap = { ...farewell, id: 4, startMs: 27_000, endMs: 27_600, text: language === 'en' ? ' I understand.' : ' Gue paham kok.' };
 const candidate = { id: 5, speaker: 'CANDIDATE', startMs: 25_400, endMs: 29_200, text: 'Please end the interview now.' };
 const fullClosing = [{ ...farewell, id: 6, startMs: 29_000, endMs: 29_200, text: ' ' + canonical.slice(0, firstClosingWord) },
  { ...farewell, id: 7, startMs: 29_200, endMs: 31_400, text: canonical.slice(firstClosingWord) }];
 const finalWindow = { start: 29_976, end: 32_698 };
 const received = { ...playback, windows: [{ start: 27_984, end: 28_623, interrupted: true }, finalWindow] };
 const fragments = [candidate, recap, ...fullClosing];
 assert.equal(directFarewellAt(fragments, received, 29_000, 28_743, language), 32_300,
  'A complete farewell after an interrupted acknowledgment must use its own playback window');
 assert.equal(directFarewellAt(fragments, received, 29_001, 28_743, language), undefined);
 assert.equal(directFarewellAt(fragments, received, 0, 29_901, language), undefined);
 assert.equal(directFarewellAt(fragments, received, 0, undefined, language), undefined);
 assert.equal(directFarewellAt(fragments, { ...received, windows: [{ ...finalWindow, interrupted: true }] }, 0, 28_743, language), undefined);
 assert.equal(directFarewellAt([candidate, { ...recap, text: recap.text + ' ' + canonical, endMs: 31_400 }], received, 0, 28_743, language), undefined);
 const lateEstimate = [{ ...candidate, endMs: 29_400 }, recap, ...fullClosing];
 assert.equal(directFarewellAt(lateEstimate, received, 0, 28_743, language), undefined);
 assert.equal(directFarewellAt(lateEstimate, received, 0, 28_743, language, 26_200), undefined,
  'a voiced packet from a previous turn cannot establish silence in the current turn');
 assert.equal(directFarewellAt(lateEstimate, received, 0, 28_743, language, 28_940), 32_300,
  'two current input measurements and complete playback can resolve a late transcript estimate');
 assert.equal(directFarewellAt(lateEstimate, received, 0, 28_743, language, 29_950), undefined,
  'new voiced input seen by the provider prevents closing even before the browser detects it');
 assert.equal(directFarewellAt(lateEstimate, { ...received, windows: [{ ...finalWindow, interrupted: true }] },
  0, 28_743, language, 28_940), undefined);
 const prompt = freezeLiveVoicePrompt('marin', language);
 const offer = createVoiceRequest('marin', 'test sdp', [], 'Alya', { prompt });
 const resume = createVoiceRequest('marin', 'test sdp', [], 'Alya', {
  prompt, remainingSeconds: 480, languageReminderDelivered: true, history: [
   { speaker: 'CANDIDATE', text: 'Saya memeriksa kualitas data.' },
   { speaker: 'TARA', text: assessmentLanguageReminders[language] },
  ],
 }, language === 'id' ? 'en' : 'id');
 assert.equal(offer.session.model, 'gpt-live-1');
 assert.equal(offer.transport.type, 'webrtc');
 assert.deepEqual(offer.session.delegation, { type: 'client' });
 assert.match(offer.session.instructions, /Delegation policy: Backend tools: none\./u);
 assert.match(resume.session.instructions, /Delegation policy: Backend tools: none\./u);
 assert.ok(offer.session.instructions.includes(assessmentLanguageReminders[language]));
 assert.ok(!resume.session.instructions.includes(assessmentLanguageReminders[language]));
 assert.equal(resume.session.instructions, prompt.resumeAfterLanguageReminder);
 assert.match(offer.session.instructions, language === 'en' ? /at most one language reminder across the entire interview/u : /arahan bahasa maksimal sekali sepanjang wawancara/u);
 assert.match(resume.session.instructions, language === 'en' ? /saved answers in English/u : /jawaban yang tersimpan dengan kata-kata Bahasa Indonesia/u);
 assert.match(resume.session.instructions, language === 'en' ? /already received the language reminder/u : /Kandidat sudah diberi arahan bahasa/u);
 assert.match(resume.session.instructions, language === 'en' ? /same closing in either case.*Say exactly/u : /penutupan normal maupun atas permintaan kandidat.*Ucapkan persis/u);
 assert.match(offer.session.input[1].content[0].text, language === 'en' ? /Ready to get started/ : /Bisa kita mulai/);
 assert.match(resume.session.input[1].content[0].text, language === 'en' ? /pick up where we left off/ : /Kita lanjut/);
 assert.match(resume.session.input[0].content[0].text, /Saya memeriksa kualitas data/);
 assert.ok(!resume.session.input[0].content[0].text.includes(assessmentLanguageReminders[language]));
 assert.match(resume.session.input[0].content[0].text, /"languageReminderDelivered":true/u);
}
console.log('Voice evidence: trusted question windows, multiple follow-ups, topic boundaries, speaker ownership and duplicate references passed.');
