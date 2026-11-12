import assert from 'node:assert/strict';
import type { CandidatePayload, Claim } from './screening.schemas';
import { acceptTakaJudgements, chatTakaTurns, freezeTakaInterview, liveTakaTurns, prepareTakaEvidence,
    scoreTakaInterview, takaEvaluationRequest } from './taka-interview';
import type { EvidenceField, taraInterviewReport, TaraOpportunity } from './tara-interview';
import { voiceTurns } from './voice/voice.policy';

const openedAt = new Date('2026-11-12T00:00:00Z');
const closedAt = new Date(+openedAt + 60_000);
const skill = (id: string, statement: string): Claim => ({ id, statement, quote: statement, criterionId: 'c0',
    lineStart: 1, lineEnd: 1, question: 'Bagian mana yang lu kerjain sendiri?', scope: 'GENERAL' });
const plan: CandidatePayload = { claims: [
    skill('design', 'Membuat materi kampanye di Figma'),
    skill('api', 'Membangun endpoint API'),
    skill('teaching', 'Membimbing praktikum'),
    skill('sales', 'Mengelola penjualan'),
], limitations: [] };
const design = 'Saya membuat aset Figma untuk kampanye. Saya menyiapkan layout dan menguji kontras sebelum handoff.';
const api = 'Gue bikin endpoint daftar pesanan dan nulis tes integrasi.';
const opportunity = (questionRef: string, options?: Partial<TaraOpportunity>): TaraOpportunity => ({
    questionRef, delivery: 'CHAT', openedAt: +openedAt, closedAt: +closedAt, connected: true, resolution: 'ANSWERED', ...options,
});
function notes(rows: Array<[string, TaraOpportunity]>): ReturnType<typeof taraInterviewReport> {
    return { version: 'tara-conversation-v8.0.0', topics: plan.claims.map(c => ({ topicId: c.id, label: c.statement,
        alternative: false, questionRefs: rows.filter(([id]) => id === c.id).map(([, opp]) => opp.questionRef), answerRefs: [],
        outcome: 'NOT_ASKED', opportunities: rows.filter(([id]) => id === c.id).map(([, opp]) => opp) })) };
}
function q(id: string, claimId: string, answer: string | null, text = plan.claims[0].question, shown = true) {
    return { id, claimId, text, answer, shownAt: shown ? openedAt : null, answeredAt: answer !== null ? closedAt : null, timedOut: false };
}
type Input = ReturnType<typeof prepareTakaEvidence>;
function judge(input: Input, ref: string, level: string, fields: EvidenceField[] = ['TASK', 'ACTION']) {
    return { level, reason: 'Penjelasan kandidat terekam.', evidence: [{ quoteRef: input.catalog.find(row => row.ref === ref)!.id, fields }], discrepancyRef: null };
}
function evaluate(input: Input, claims: Record<string, unknown>, interrupted = false) {
    return scoreTakaInterview(input, acceptTakaJudgements(input, input.plan.claims.map(c => c.id), { claims }), interrupted);
}
const chat = prepareTakaEvidence(plan, chatTakaTurns([q('q1','design',design),q('q2','api',api),q('q3','sales',null,undefined,false)]));
const two = evaluate(chat, { design: judge(chat,'q1','STRONG'), api: judge(chat,'q2','CONCRETE'), teaching: null, sales: null });
assert.equal(two.score, 87.5);
assert.equal(two.coverage.state, 'PARTIAL');
assert.deepEqual(two.result.claims.map(c => c.score), [4,3,null,null]);
assert.deepEqual([two.coverage.assessedClaims,two.coverage.plannedClaims], [2,4]);
assert.equal(two.result.claims[2].assessment?.state, 'NOT_ASKED');
assert.equal(two.result.claims[0].evidence[0].quote, design);
const one = evaluate(chat, { design: judge(chat,'q1','STRONG'), api: null, teaching: null, sales: null });
assert.equal(one.score, 100);
assert.equal(one.coverage.assessedClaims, 1);
const ninePlan = { ...plan, claims: [...plan.claims, ...Array.from({ length: 5 }, (_, i) => skill('other'+i,'Klaim lain'))] };
const nine = prepareTakaEvidence(ninePlan, [...chat.turns, ...chatTakaTurns([q('q4','teaching','Saya menyusun latihan dan membimbing sesi praktikum.')])]);
const nineResult = evaluate(nine,{ design: judge(nine,'q1','STRONG'),api:judge(nine,'q2','CONCRETE'),teaching:judge(nine,'q4','PARTIAL') });
assert.equal(nineResult.score, 75);
assert.deepEqual([nineResult.coverage.assessedClaims,nineResult.coverage.plannedClaims], [3,9]);
assert.equal(evaluate(prepareTakaEvidence(plan, []), {}).score, null);
assert.equal(evaluate(prepareTakaEvidence({ claims: [], limitations: [] }, []), {}).coverage.state, 'ALTERNATIVE');

const compared = voiceTurns([
    { id: 1, speaker:'TARA',text:plan.claims[0].question,startMs:0,endMs:1,eventId:'tara-playback:1' },
    { id: 2, speaker:'CANDIDATE',text:design,startMs:2000,endMs:2500 },
    { id: 3, speaker:'TARA',text:plan.claims[1].question,startMs:4000,endMs:4001,eventId:'tara-playback:2' },
    { id: 4, speaker:'CANDIDATE',text:api,startMs:5000,endMs:5500 },
    { id: 5, speaker:'TARA',text:plan.claims[2].question,startMs:6000,endMs:6001,eventId:'tara-playback:3' },
    { id: 6, speaker:'TARA',text:plan.claims[3].question,startMs:6200,endMs:6201,eventId:'tara-playback:4' },
]);
assert.equal(compared.length, 6, 'each confirmed Tara question keeps its own reference');
const live = prepareTakaEvidence(plan,liveTakaTurns(compared,openedAt,false,notes([
    ['design',opportunity('v1',{delivery:'AUDIO'})],['api',opportunity('v3',{delivery:'TEXT_FALLBACK',resolution:'INTERRUPTED'})],
    ['teaching',opportunity('v5',{delivery:'AUDIO',resolution:'INTERRUPTED'})],
])));
assert.equal(live.turns.some(turn=>turn.questionRef==='v6'),false,'unconfirmed playback cannot be assessed');
const fromLive = evaluate(live,{design:judge(live,'v2','STRONG'),api:judge(live,'v4','CONCRETE'),teaching:null,sales:null},true);
assert.equal(fromLive.score,two.score);
assert.deepEqual(fromLive.result.claims.map(c=>c.score),two.result.claims.map(c=>c.score));
assert.equal(fromLive.result.claims[2].assessment?.state,'TECHNICAL_INTERRUPTION');
assert.equal(fromLive.result.claims[1].evidence[0].quote,api);

const expanded = structuredClone(plan);
expanded.claims[0].extraEvidence = [{ field:'RESULT', cvQuote:'materi kampanye' }];
const omitted = prepareTakaEvidence(expanded,chat.turns);
assert.equal(evaluate(omitted,{design:judge(omitted,'q1','STRONG')}).result.claims[0].score,4);
assert.deepEqual(evaluate(omitted,{design:judge(omitted,'q1','STRONG')}).result.claims[0].assessment!.openFields,['RESULT']);
const probed = prepareTakaEvidence(expanded,[...chat.turns,...chatTakaTurns([q('q-result','design','Saya belum tahu hasilnya.','Apa hasil dari pekerjaan lu?')])]);
assert.equal(evaluate(probed,{design:judge(probed,'q1','STRONG')}).result.claims[0].score,2,'a specifically tested gap can affect the grade');

const irrelevant = 'Saya lebih suka membahas jadwal liburan saya.';
const wandered = prepareTakaEvidence(plan,chatTakaTurns([q('q1','design',irrelevant)]));
assert.equal(evaluate(wandered,{design:judge(wandered,'q1','OFF_TOPIC',[])}).score,null);
const redirected = prepareTakaEvidence(plan,chatTakaTurns([q('q1','design',irrelevant)],notes([['design',opportunity('q1',{redirected:true})]])));
const fairZero = evaluate(redirected,{design:judge(redirected,'q1','OFF_TOPIC',[])});
assert.equal(fairZero.score,0);
assert.equal(fairZero.result.claims[0].evidence[0].quote,irrelevant);
const silence = (connected: boolean) => prepareTakaEvidence(plan,chatTakaTurns([
    {...q('q1','design',''),timedOut:true},
],notes([['design',opportunity('q1',{connected,resolution:'WINDOW_EXPIRED'})]])));
assert.equal(evaluate(silence(true),{}).score,0);
assert.equal(evaluate(silence(false),{}).score,null);
const silenceAfterRedirect = prepareTakaEvidence(plan,chatTakaTurns([q('q1','design',irrelevant),
    {...q('q2','design',''),timedOut:true}],notes([['design',opportunity('q2',{redirected:true,resolution:'WINDOW_EXPIRED'})]])));
const redirectSilence = evaluate(silenceAfterRedirect,{design:judge(silenceAfterRedirect,'q1','OFF_TOPIC',[])});
assert.equal(redirectSilence.score,0);
assert.equal(redirectSilence.result.claims[0].assessment?.questionRefs[0],'q2');
const mixed = prepareTakaEvidence(plan,[...redirected.turns,...chatTakaTurns([q('q2','api',api)])]);
assert.equal(evaluate(mixed,{design:judge(mixed,'q1','OFF_TOPIC',[]),api:judge(mixed,'q2','STRONG')}).score,50,
    'confirmed zero stays in the denominator');
const decline = prepareTakaEvidence(plan,chatTakaTurns([q('q1','design','Saya belum pernah pakai Figma dan tidak punya contoh.')]));
assert.equal(evaluate(decline,{design:judge(decline,'q1','DECLINED',[])}).score,0);
const draf = prepareTakaEvidence(plan,chatTakaTurns([{...q('draft','api',api),timedOut:true}],notes([
    ['api',opportunity('draft',{resolution:'CUT_SHORT'})],
])));
assert.equal(evaluate(draf,{api:judge(draf,'draft','CONCRETE')}).score,75,'sufficient locked draft survives the cutoff');
assert.equal(evaluate(draf,{api:judge(draf,'draft','GENERAL',['TASK'])}).score,null,'cutoff cannot depress the score with unfinished evidence');
const joint = prepareTakaEvidence(plan,chatTakaTurns([q('joint','design',design+' '+api)]));
const jointSource = joint.catalog.find(row=>row.text.includes('endpoint'))!;
const jointResult = evaluate(joint,{design:judge(joint,'joint','STRONG'),api:{...judge(joint,'joint','CONCRETE'),
    evidence:[{quoteRef:jointSource.id,fields:['TASK','ACTION']}]},sales:judge(joint,'joint','GENERAL',[])});
assert.equal(jointResult.result.claims[1].assessment?.basis,'VOLUNTEERED');
assert.equal(jointResult.result.claims[3].score,null);
assert.equal(jointResult.score,87.5);
const longAnswer = prepareTakaEvidence(plan,chatTakaTurns([q('long','api','Konteks proyek. '.repeat(60)+api)]));
const lateQuote = longAnswer.catalog.at(-1)!;
assert.ok(lateQuote.text.includes('endpoint'));
assert.equal(evaluate(longAnswer,{api:{...judge(longAnswer,'long','STRONG'),evidence:[{quoteRef:lateQuote.id,fields:['TASK','ACTION']}]}}).score,100);
assert.equal(acceptTakaJudgements(chat,['design'],{claims:{design:{...judge(chat,'q1','STRONG'),
    evidence:[{quoteRef:'answer:other-session:0',fields:['TASK','ACTION']}]}}}).size,0);
assert.equal(acceptTakaJudgements(chat,['design'],{claims:{design:judge(chat,'q1','STRONG',['TASK'])}}).size,0);
assert.deepEqual(takaEvaluationRequest(freezeTakaInterview(),chat,[plan.claims[1]]).preset.schema.properties!.claims.required,['api']);
console.log('Taka coverage smoke passed: 2/4, 1/4, 3/9, Live/Chat parity, unasked detail, disconnection, text fallback, redirect, silence, draft, cross-topic evidence and invalid references. Paid calls: 0.');
