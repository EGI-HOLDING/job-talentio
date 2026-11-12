export const VOICE_VERSION='tara-voice-v2';
export const VOICE_WARN_MS=10*60_000, VOICE_CLOSE_MS=14*60_000, VOICE_HARD_MS=15*60_000;
export type Fragment={id:number;speaker:string;text:string;startMs:number;endMs:number;eventId?:string};
export type VoiceTurn={id:string;speaker:string;text:string;startMs:number;endMs:number;fragmentIds:number[]};
// Provider deltas are fragments, never complete turns. Preserve delivery order and original evidence IDs.
export function voiceTurns(rows:Fragment[]):VoiceTurn[]{
 const turns:VoiceTurn[]=[];
 for(const row of rows){const previous=turns.at(-1);if(previous&&previous.speaker===row.speaker&&!row.eventId?.startsWith('tara-playback:')&&row.startMs-previous.endMs<1800){previous.text+=row.text;previous.endMs=Math.max(previous.endMs,row.endMs);previous.fragmentIds.push(row.id);}else turns.push({id:'v'+row.id,speaker:row.speaker,text:row.text,startMs:row.startMs,endMs:row.endMs,fragmentIds:[row.id]});}
 return turns;
}
export function voiceClock(startedAt:Date,now:Date){const elapsed=Math.max(0,+now-+startedAt);return{elapsed,warning:elapsed>=VOICE_WARN_MS,closing:elapsed>=VOICE_CLOSE_MS,hard:elapsed>=VOICE_HARD_MS,remainingSeconds:Math.max(0,Math.ceil((VOICE_HARD_MS-elapsed)/1000))};}
