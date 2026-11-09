import type { VoiceTurn } from './voice.policy';

export type VoiceOpportunity={questionRef:string;answerRefs:string[]};
export function voiceOpportunities(turns:VoiceTurn[]):VoiceOpportunity[]{
 const windows:VoiceOpportunity[]=[];
 let current:VoiceOpportunity|undefined,questionStart=0;
 for(const turn of turns){
  if(turn.speaker==='TARA'){current={questionRef:turn.id,answerRefs:[]};questionStart=turn.startMs;windows.push(current);}
  else if(current&&turn.speaker==='CANDIDATE'&&turn.startMs>=questionStart)current.answerRefs.push(turn.id);
 }
 return windows;
}
export function voiceEvidence(turns:VoiceTurn[],opportunities:VoiceOpportunity[]){
 const windows=voiceOpportunities(turns),used=new Set<string>();
 const answers:Array<VoiceTurn&{questionRef:string;questionText:string}>=[];
 for(const opportunity of opportunities){
  const question=turns.find(t=>t.id===opportunity.questionRef&&t.speaker==='TARA');
  const window=windows.find(w=>w.questionRef===opportunity.questionRef);
  if(!question||!window||used.has(question.id))throw Error('VOICE_INVALID_OPPORTUNITY');
  used.add(question.id);
  for(const ref of opportunity.answerRefs){
   if(used.has(ref)||!window.answerRefs.includes(ref))throw Error('VOICE_UNGROUNDED_ANSWER');
   const turn=turns.find(t=>t.id===ref)!;used.add(ref);answers.push({...turn,questionRef:question.id,questionText:question.text});
  }
 }
 return answers;
}
