import assert from 'node:assert/strict';
import { voiceEvidence,voiceOpportunities } from './voice-evidence';
import { directFarewellAt } from './voice-role';
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
console.log('Voice evidence: trusted question windows, multiple follow-ups, topic boundaries, speaker ownership and duplicate references passed.');
