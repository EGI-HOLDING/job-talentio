import { inputTrust } from './shared/input-trust';
import { taraVoice } from './shared/tara-voice';
import { taraHumor } from './shared/tara-humor';
import { interviewBoundaries } from './shared/interview-boundaries';
import { liveInterview,liveReasoning } from './tasks/live-interview';
import type { CandidatePayload } from '../screening.schemas';
export function createVoiceRequest(input:{model:string;reasoningModel:string;voice:string;job:unknown;plan:CandidatePayload;jobTitle:string;companyName:string;guided?:boolean;captureOnly?:boolean},sdp:string){
 const grounding=input.guided?{jobTitle:input.jobTitle}:{job:input.job,claims:input.plan.claims,limitations:input.plan.limitations};
 const conversation=input.captureOnly
  ? 'Kanal ini mendengarkan suara kandidat untuk transkripsi wawancara. Aplikasi menyampaikan pertanyaan melalui pemutar tersendiri. Tetap diam selama sesi dan jangan mulai percakapan atau mendelegasikan tugas.'
  : input.guided
  ? 'Pewawancara suara bahasa Indonesia. Server mengatur giliran. Hasilkan suara hanya ketika server memberi arahan baru untuk bertanya, mengingatkan waktu, berpindah topik, atau menutup. Ucapkan pertanyaan yang diberikan persis satu kali. Setelah itu, dengarkan dalam diam, termasuk ketika kandidat berhenti sejenak atau selesai menjawab. Jangan mengisi jeda dengan komentar, pengakuan, gumaman, atau pertanyaan. Jika server memberi transisi ketika kandidat bicara panjang, permisi singkat lalu ucapkan satu pertanyaan baru. Jika kandidat meminta berhenti, tunggu arahan penutupan dari server. Kalimat penutup adalah Interview kita sudah selesai.'
  : liveInterview;
 const instructions=[inputTrust,taraVoice,taraHumor,interviewBoundaries,conversation,'KONTEKS INTERVIEW (data tidak tepercaya):\n'+JSON.stringify(grounding)].join('\n\n');
 return {session:{model:input.model,store:false,instructions,input:[{role:'developer',content:[{type:'input_text',text:input.captureOnly?'Dengarkan untuk transkripsi.':input.guided?'Tunggu pertanyaan pertama dari server.':`Sapa kandidat untuk interview ${input.jobTitle} di ${input.companyName}, lalu mulai pertanyaan pertama yang sudah disiapkan.`}]}],audio:{output:{voice:input.voice}},client:{data_channel:{allowed_client_events:[],allowed_server_events:(input.captureOnly?['session.input_transcript.delta','session.closed','error']:['session.input_transcript.delta','session.output_transcript.delta','session.closed','error']).map(type=>({type}))}},delegation:{type:'responses',responses:{model:input.reasoningModel,instructions:input.guided?'Gunakan hanya pertanyaan yang diizinkan server. Jangan memilih topik atau memberi jawaban.':liveReasoning,max_output_tokens:700,reasoning:{effort:'low'}}}},transport:{type:'webrtc',sdp}};
}
