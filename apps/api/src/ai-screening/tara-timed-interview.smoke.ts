import assert from 'node:assert/strict';
import { advanceTara, startTara, taraInterviewReport, validTaraDecision, type TaraDecision, type TaraTopic } from './tara-interview';

const topics: TaraTopic[] = ['SQL', 'Python', 'Dashboard', 'Experiment design'].map((label, i) => ({
    id:'topic-'+i,criterionId:'role-'+i,label,question:`Bagian mana yang lu tangani pakai ${label}?`,
    priority:'CORE',fields:['TASK','ACTION'],alternative:false,
}));
const expected = [
    'Saya membuat query SQL untuk data penjualan dan menulis skrip Python untuk membersihkannya.',
    'Saya menulis fungsi Python untuk menghapus baris duplikat.',
    'Saya menyusun dashboard pemantauan pesanan dan membuat filter wilayah.',
    'Saya menentukan kelompok uji dan metrik utama eksperimen checkout.',
];
function replay() {
    let progress = startTara(topics, true);
    for (const [index, topic] of topics.entries()) {
        const answer = expected[index];
        const ref = 'q' + index;
        const evidence: TaraDecision['evidence'] = [{ topicId: topic.id, quote: answer, fields: ['TASK', 'ACTION'] }];
        if (index === 0) evidence.push({ topicId: topics[1].id, quote: answer, fields: ['TASK', 'ACTION'] });
        const decision = validTaraDecision({ outcome: 'EXAMPLE', answerQuote: answer, question: null, evidence }, answer, [], topics);
        const next = advanceTara(progress, topics, {
            questionRef: ref, answerRefs: [ref], answered: true, previous: [], decision, answers: [{ ref, text: answer }],
            opportunity: { questionRef: ref, openedAt: index * 60_000, closedAt: index * 60_000 + 15_000, delivery: 'CHAT' },
        });
        progress = next.progress;
        assert.equal(Boolean(next.question), index < topics.length - 1);
    }
    const result = taraInterviewReport(progress, topics);
    assert.deepEqual(result.topics.map(topic => topic.outcome), topics.map(() => 'CONCRETE_EXAMPLE'));
    assert.ok(result.topics[1].evidence?.some(item => item.fromTopic === topics[0].id));
    assert.ok(result.topics.every(topic => topic.opportunities?.[0].delivery === 'CHAT'));
}

function conversationEdges() {
    const initial=startTara(topics,true);
    const answer='Saya menangani persediaan gudang.';
    const send=(progress:ReturnType<typeof startTara>, outcome:TaraDecision['outcome']) => advanceTara(progress,topics,{
        questionRef:'q'+progress.questions,answerRefs:['a'+progress.questions],answered:true,previous:[],
        decision:{outcome,answerQuote:answer,question:null,evidence:[]},
    });
    let r=send(initial,'OFF_TOPIC');
    assert.match(r.question!,/tarik balik/);
    r=send(r.progress,'OFF_TOPIC');
    assert.equal(r.progress.active,1);
    assert.equal(r.progress.topics[0].note.reason,'AFTER_REDIRECT');
    r=send(r.progress,'DISCREPANCY');
    assert.notEqual(r.progress.topics[1].note.outcome,'CLARIFIED_DISCREPANCY');
    r=send(r.progress,'DISCREPANCY');
    assert.equal(r.progress.topics[1].note.outcome,'CLARIFIED_DISCREPANCY');
    const expired=advanceTara(r.progress,topics,{answerRefs:[],answered:false,previous:[]},{canContinue:false});
    assert.equal(expired.progress.endedReason,'TIME_LIMIT');
    assert.equal(expired.progress.topics[3].note.outcome,'NOT_ASKED');
    const grounded=validTaraDecision({outcome:'EXAMPLE',answerQuote:answer,question:null,evidence:[
        {topicId:topics[0].id,quote:'Klaim rekaan',fields:['TASK','ACTION']},
    ]},answer,[],topics);
    const noEvidence=advanceTara(initial,topics,{questionRef:'q1',answerRefs:['a1'],answered:true,previous:[],decision:grounded});
    assert.notEqual(noEvidence.progress.topics[0].note.outcome,'CONCRETE_EXAMPLE');
}

conversationEdges();
replay();
console.log('Tara timed Chat: four opportunities, cross-topic evidence, redirects, clarifications and expiry. Paid calls: 0.');
