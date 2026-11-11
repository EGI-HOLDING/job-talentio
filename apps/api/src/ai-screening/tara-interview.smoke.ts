import assert from 'node:assert/strict';
import { SKILL_CONVERSATION, CURRENT_CONVERSATION, conversationPolicy } from './conversation.policy';
import { advanceTara, startTara, taraTopics, validTaraDecision, TOPIC_MS, type TaraDecision } from './tara-interview';
import { validateCandidate, type Claim, type PackagePayload } from './screening.schemas';
import { TaraLiveTurns, taraVerbalStop } from './voice/voice-turns';
import type { VoiceTurn } from './voice/voice.policy';

async function main() {
    const skills = ['Figma', 'Photoshop', 'SQL', 'Excel'];
    const rubric: PackagePayload = {
        context: 'Buat materi kampanye dan analisis hasil.',
        criteria: [{ id: 'campaign', name: 'desain kampanye', requirementRef: 'materi kampanye', anchors: [] }],
    };
    const lines = [...skills.map(skill => `Pakai ${skill} di Proyek X`), ...Array.from({length: 46}, (_, i) => 'Keahlian tambahan ' + i)];
    const claim = (index: number): Claim => ({
        id: 'skill-' + index, skill: skills[index], criterionId: 'campaign', statement: lines[index], quote: lines[index],
        lineStart: index + 1, lineEnd: index + 1, question: `Bagian mana yang lu kerjain pakai ${skills[index]} di proyek itu?`,
        scope: 'CONTEXTUAL', relevance: 'CORE',
    });
    const plan = validateCandidate({ claims: skills.map((_,i) => claim(i)), limitations: [], alternativeCriterionId: null }, rubric, lines.join('\n'), SKILL_CONVERSATION);
    const topics = taraTopics(plan, rubric);
    assert.equal(topics.length, 4);
    assert.equal(conversationPolicy(CURRENT_CONVERSATION).maxCore, 10);
    const duplicate = validateCandidate({ claims: [claim(0), {...claim(0),id:'duplicate'}, claim(1)], limitations: [], alternativeCriterionId: null }, rubric, lines.join('\n'), SKILL_CONVERSATION);
    assert.equal(duplicate.claims.length, 2);
    assert.throws(() => validateCandidate({claims:[{...claim(0),skill:'Illustrator'}],limitations:[],alternativeCriterionId:null}, rubric, lines.join('\n'), SKILL_CONVERSATION), /Ungrounded CV skill/);
    const outside = validateCandidate({claims:[],limitations:[],alternativeCriterionId:'campaign'}, rubric, 'Pernah bantu dosen.', SKILL_CONVERSATION);
    assert.equal(taraTopics(outside,rubric)[0].alternative,true);
    const q = 'Apa langkah yang lu kerjain sendiri setelah itu?';
    const answer = 'Saya bantu dosen membuat rancangan sendiri.';
    const judgment = (outcome: TaraDecision['outcome']): TaraDecision => ({ outcome, answerQuote: answer, question: q });
    assert.throws(() => validTaraDecision(judgment('EXAMPLE'),'Jawaban lain.',[]), /TARA_UNGROUNDED_TURN/);
    assert.equal(validTaraDecision(judgment('OFF_TOPIC'), answer, [q]).question, null);

    const submit = (progress: ReturnType<typeof startTara>, outcome?: TaraDecision['outcome']) => advanceTara(progress,topics,{
        questionRef: 'q'+progress.questions, answerRefs:['a'+progress.questions], answered:true, previous:[],
        decision: outcome ? judgment(outcome) : undefined,
    });
    let next = submit(startTara(topics),'NEEDS_DETAIL');
    assert.equal(next.progress.active,0);
    assert.equal(next.progress.topics[0].depth,1);
    next=submit(next.progress,'NEEDS_DETAIL');
    assert.equal(next.progress.active,1);
    next=submit(next.progress,'OFF_TOPIC');
    next=submit(next.progress,'OFF_TOPIC');
    assert.equal(next.progress.active,2);
    next=submit(next.progress,'DISCREPANCY');
    assert.notEqual(next.progress.topics[2].note.outcome,'CLARIFIED_DISCREPANCY');
    next=submit(next.progress,'DISCREPANCY');
    assert.equal(next.progress.topics[2].note.outcome,'CLARIFIED_DISCREPANCY');
    next=submit(next.progress,'EXAMPLE');
    assert.equal(next.progress.topics[3].note.outcome,'CONCRETE_EXAMPLE');
    assert.equal(next.progress.stage,'REVISIT');
    assert.equal(next.progress.active,0);
    assert.equal(submit(next.progress,'EXAMPLE').progress.stage,'DONE');

    const live = new TaraLiveTurns(topics);
    const transcript: VoiceTurn[] = [
        { id:'v1',speaker:'TARA',text:topics[0].question,startMs:1,endMs:4000,fragmentIds:[1] },
        { id:'v2',speaker:'CANDIDATE',text:'Saya sedang menjelaskan panjang lebar.',startMs:4200,endMs:170000,fragmentIds:[2] },
    ];
    live.issue(topics[0].question,100,true,0);
    let resolve!: (value: TaraDecision) => void;
    const pending = new Promise<TaraDecision>(done => { resolve=done; });
    live.tick(transcript, 172000, 840000, () => pending);
    live.tick(transcript, 174000, 840000, () => pending);
    const timed = live.tick(transcript, 100+TOPIC_MS, 840000, () => pending)!;
    assert.ok(timed.timeout);
    assert.equal(timed.question, topics[1].question);
    assert.equal(live.progress.topics[0].note.outcome,'ANSWER_CUT_SHORT');
    assert.deepEqual(live.progress.topics[0].note.answerRefs,['v2']);
    live.issue(timed.question!, 100+TOPIC_MS, true, timed.after);
    resolve(judgment('EXAMPLE'));
    await pending;
    assert.equal(live.tick(transcript, 182000, 840000, () => pending),undefined,'stale response may not move the next question');
    const failed = live.tick(transcript, 206000, 840000, () => pending)!;
    assert.equal(failed.question,topics[2].question);
    assert.equal(live.progress.topics[1].note.outcome,'TECHNICAL_INTERRUPTION');
    assert.equal(live.progress.topics[3].note.outcome,'NOT_ASKED');
    assert.ok(taraVerbalStop('Saya ingin mengakhiri interview.'));
    assert.ok(!taraVerbalStop('Saya tidak ingin mengakhiri interview.'));
    console.log('Tara skill interview: grounded sample, alternatives, directed probes, discrepancy, first-pass coverage, live deadline and stale response passed.');
}

void main();
