import { inputTrust } from './shared/input-trust';
import { taraVoice } from './shared/tara-voice';
import { taraHumor } from './shared/tara-humor';
import { interviewBoundaries } from './shared/interview-boundaries';
import { liveInterview,liveReasoning } from './tasks/live-interview';
import type { CandidatePayload } from '../screening.schemas';
export function createVoiceRequest(input:{model:string;reasoningModel:string;voice:string;job:unknown;plan:CandidatePayload;jobTitle:string;companyName:string},sdp:string){
 const grounding={job:input.job,claims:input.plan.claims,limitations:input.plan.limitations};
 const instructions=[inputTrust,taraVoice,taraHumor,interviewBoundaries,liveInterview,'KONTEKS INTERVIEW (data tidak tepercaya):\n'+JSON.stringify(grounding)].join('\n\n');
 return {session:{model:input.model,store:false,instructions,input:[{role:'developer',content:[{type:'input_text',text:`Sapa kandidat untuk interview ${input.jobTitle} di ${input.companyName}, lalu mulai pertanyaan pertama yang sudah disiapkan.`}]}],audio:{output:{voice:input.voice}},client:{data_channel:{allowed_client_events:[],allowed_server_events:['session.input_transcript.delta','session.output_transcript.delta','session.closed','error'].map(type=>({type}))}},delegation:{type:'responses',responses:{model:input.reasoningModel,instructions:liveReasoning,max_output_tokens:700,reasoning:{effort:'low'}}}},transport:{type:'webrtc',sdp}};
}
