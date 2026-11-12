import assert from 'node:assert/strict';
import { advanceTara, startTara, taraBudget, taraInterviewReport, TARA_COMPLETE_MS, TARA_FIRST_PASS_MS,
    TARA_SESSION_MS, validTaraDecision, type TaraDecision, type TaraTopic } from './tara-interview';
import { TaraLiveTurns } from './voice/voice-turns';
import type { VoiceTurn } from './voice/voice.policy';

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
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

async function replay(timed: boolean) {
    const live = new TaraLiveTurns(topics, timed);
    const turns: VoiceTurn[] = [], opportunities: number[] = [];
    let now = 1000, serial = 0, next = topics[0].question, index = 0, calls = 0;
    const inspect = async (topic: TaraTopic, _question: string, answer: string): Promise<TaraDecision> => {
        calls++;
        const i = topics.indexOf(topic);
        assert.ok(answer.includes(expected[i]));
        const evidence: TaraDecision['evidence'] = [{topicId:topic.id,quote:expected[i],fields:['TASK','ACTION']}];
        if (i === 0) evidence.push({topicId:topics[1].id,quote:expected[0],fields:['TASK','ACTION']});
        return {outcome:'EXAMPLE',answerQuote:expected[i],question:null,evidence};
    };
    while (index < 4) {
        live.issue(next, now, true, serial);
        if (timed && index === 0) {
            const unauthorized = {id:'not-delivered',speaker:'TARA',text:next,startMs:now+1,endMs:now+100,fragmentIds:[9999]};
            assert.equal(live.questionWindow([unauthorized]), undefined);
        }
        now += 5000;
        opportunities.push(now);
        const id = 'v'+ ++serial;
        turns.push({id,speaker:'TARA',text:next,startMs:now-4000,endMs:now,fragmentIds:[serial]});
        if (timed) live.delivered(id,now,index===2?'TEXT_FALLBACK':'AUDIO');
        const spokenAt = now;
        let answer = '';
        for (; now < TARA_SESSION_MS + 1000; now += 1000) {
            if (now - spokenAt === 3000) {
                answer = expected[index];
                const id = 'v'+ ++serial;
                turns.push({id,speaker:'CANDIDATE',text:answer,startMs:now,endMs:now+1,fragmentIds:[serial]});
            }
            if (index === 0 && answer) {
                const continuing = turns.at(-1)!;
                continuing.text += ' Lalu ada cerita lain.';
                continuing.fragmentIds.push(++serial);
                continuing.endMs = now+1;
            }
            const result=live.tick(turns,now,1000+TARA_COMPLETE_MS,inspect);
            await flush();
            if (!result) continue;
            index++;
            if (index < 4) {
                assert.ok(result.question);
                next = result.question;
            } else assert.equal(result.question,null);
            break;
        }
        assert.ok(now <= TARA_SESSION_MS);
    }
    return {report:taraInterviewReport(live.progress,topics),opportunities,ended:now,calls};
}

function conversationEdges() {
    const initial=startTara(topics,true), now=1000;
    assert.equal(taraBudget(initial,4,now,now,'VOICE').topicEnd,166000);
    assert.ok(!taraBudget(initial,4,now,now+TARA_COMPLETE_MS-1000,'VOICE').canRevisit);
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

function reserveTimeForEveryClaim() {
    const live = new TaraLiveTurns(topics,true);
    const transcript: VoiceTurn[] = [];
    let now=1000, fragment=0, question=topics[0].question;
    for (const index of topics.keys()) {
        live.issue(question,now,true,fragment);
        const ref='v'+ ++fragment;
        transcript.push({id:ref,speaker:'TARA',text:question,startMs:now+1000,endMs:now+10000,fragmentIds:[fragment]});
        live.delivered(ref,now+10000,'AUDIO');
        now=taraBudget(live.progress,topics.length,1000,now,'VOICE').topicEnd;
        const next=live.tick(transcript,now,1000+TARA_COMPLETE_MS,async()=>{throw Error('No speech should use no analysis');});
        assert.equal(next?.question,topics[index+1]?.question??null);
        question=next?.question??'';
    }
    assert.equal(now-1000,TARA_FIRST_PASS_MS);
    assert.ok(live.progress.topics.every(topic=>topic.note.reason==='TIME_LIMIT' && topic.note.opportunities?.length===1));
}

async function main() {
    conversationEdges();
    reserveTimeForEveryClaim();
    const baseline=await replay(false), improved=await replay(true);
    assert.ok(improved.ended<baseline.ended);
    assert.ok(improved.opportunities.every(at=>at-1000 <= TARA_FIRST_PASS_MS));
    assert.equal(baseline.report.topics[0].outcome,'ANSWER_CUT_SHORT');
    assert.deepEqual(improved.report.topics.map(topic=>topic.outcome),topics.map(()=> 'CONCRETE_EXAMPLE'));
    assert.ok(improved.report.topics[1].evidence?.some(item=>item.fromTopic===topics[0].id));
    assert.equal(improved.report.topics[2].opportunities?.[0].delivery,'TEXT_FALLBACK');
    console.log('Tara virtual replay:',JSON.stringify({baselineSeconds:(baseline.ended-1000)/1000,timedSeconds:(improved.ended-1000)/1000,
        firstOpportunitiesSeconds:improved.opportunities.map(time=>(time-1000)/1000),complete:4,paidCalls:0}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
