import assert from 'node:assert/strict';
import { CURRENT_CONVERSATION, V5_CONVERSATION, V4_CONVERSATION, conversationPolicy, publicConversationPolicy } from '../conversation.policy';
import { canProbe, answerDeadline, nextProbeTarget, type ProbeQuestion } from '../screening.policy';
import { conversationSchemas, assertSchema } from '../screening.schemas';
assert.equal(CURRENT_CONVERSATION.maxCore,10);
assert.equal(CURRENT_CONVERSATION.maxFollowUp,15);
assert.equal(publicConversationPolicy(CURRENT_CONVERSATION).maxQuestions,25);
assert.equal(+answerDeadline(new Date(0),CURRENT_CONVERSATION),60000);
assert.deepEqual(conversationPolicy(JSON.parse(JSON.stringify(V5_CONVERSATION))),V5_CONVERSATION);
assert.equal(conversationPolicy(V5_CONVERSATION).maxCore,3);
assert.equal(conversationPolicy(V4_CONVERSATION).questionSeconds,30);
const claims=Array.from({length:10},(_,i)=>({id:'c'+i,criterionId:'a',statement:'Relevan',quote:'Teks sumber',lineStart:1,lineEnd:1,question:'Bagian apa yang lu tangani dalam proyek ini?'}));
const schema=conversationSchemas(CURRENT_CONVERSATION).candidate;
assertSchema(schema,{claims,limitations:[]});
assert.throws(()=>assertSchema(schema,{claims:[...claims,{...claims[0],id:'too-many'}],limitations:[]}));
const questions:ProbeQuestion[]=claims.map((c,i)=>({id:c.id,position:i,kind:'CORE',claimId:c.id,criterionId:'a',answer:'Saya menangani implementasi.',rootQuestionId:null,depth:0,probeClosed:false}));
for(let i=0;i<15;i++){
 const target=nextProbeTarget(questions,CURRENT_CONVERSATION);assert.ok(target);
 assert.ok(canProbe(questions,target.root.id,CURRENT_CONVERSATION));
 questions.push({id:'follow-'+i,position:questions.length,kind:'FOLLOW_UP',claimId:target.root.claimId,criterionId:'a',answer:'Saya menguji hasilnya.',rootQuestionId:target.root.id,depth:target.depth,probeClosed:false});
}
assert.equal(questions.length,25);assert.equal(nextProbeTarget(questions,CURRENT_CONVERSATION),null);
console.log('Invited text screening: max 10 initial, 25 total, 60 seconds; historical session policy preserved.');
