export type Evidence={questionId:string;questionRef?:string;questionText?:string;quote:string};
export type Claim={claimId:string;score?:number|null;status:string;asked?:boolean;reason:string;evidence?:Evidence[];contradictions?:Array<{left:{source:string;quote:string};right:{source:string;quote:string}}>};
export type TaraInterviewNotes={version:string;endedReason?:string;topics:Array<{topicId:string;label:string;alternative:boolean;outcome:string;questionRefs:string[];answerRefs:string[];quote?:string;reason?:string;fields?:string[];cvQuote?:string;requirementRef?:string;evidence?:Array<{answerRef:string;quote:string;fields:string[];fromTopic:string}>;opportunities?:Array<{questionRef:string;openedAt?:number;closedAt?:number;delivery:string}>}>};
export type ScreeningEvaluation={summary?:string;strengths?:string[];gaps?:string[];interviewQuestions?:string[];claims?:Claim[];taraInterview?:TaraInterviewNotes;voice?:{testedClaims:number;totalClaims:number;partial:boolean;durationSeconds?:number;transcriptComplete?:boolean;closeReason?:string|null}};
export type Invitation={id:string;mode:'TEXT'|'VOICE';status:string;closedByStage?:boolean;expiresAt:string;recipientEmail:string;emailStatus:string;messageStatus:string;error?:string|null;createdAt:string;session:{id:string;status:string;startedAt?:string|null;completedAt:string|null;evaluation:{status:string;screeningScore:number|null;result:ScreeningEvaluation|null}|null}|null};
export type Turn={id:string;speaker:string;text:string;startMs:number|null;timedOut?:boolean};
export type Report={pdfStatus?:'NOT_READY'|'PENDING'|'FAILED'|'READY';claims?:Array<{id:string;statement:string;quote:string}>;invitation?:Invitation;voice?:{startedAt?:string;endedAt?:string;closeReason:string;transcriptComplete:boolean;transcript:Array<{id:string;speaker:string;text:string;startMs:number}>}|null;questions:Array<{id:string;text:string;answer:string|null;shownAt?:string|null;answeredAt?:string|null;timedOut:boolean}>;evaluation:{status:string;score:number|null;result:ScreeningEvaluation|null}|null;pdfUrl:string|null};
export const number=(n:number|null|undefined)=>n==null?'\u2014':n.toLocaleString('id-ID',{maximumFractionDigits:1});
export const date=(s:string|null|undefined,time=false)=>s?new Date(s).toLocaleString('id-ID',time?{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}:{day:'numeric',month:'short',year:'numeric'}):'\u2014';
export const clock=(ms:number|null|undefined)=>ms==null?'\u2014':`${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
export const typeName=(i:Invitation)=>i.mode==='VOICE'?'Interview suara':'Interview teks';
export const active=(i:Invitation)=>!i.closedByStage&&['INVITED','STARTED'].includes(i.status)&&(i.status==='STARTED'||Date.parse(i.expiresAt)>Date.now());
export function status(i:Invitation){
 if(i.closedByStage)return 'Ditutup';
 if(i.status==='CANCELLED')return 'Dibatalkan';
 if(i.status==='INVITED')return Date.parse(i.expiresAt)<=Date.now()?'Kedaluwarsa':'Menunggu kandidat';
 if(i.status==='STARTED')return 'Sedang berlangsung';
 if(i.status!=='COMPLETED')return 'Sedang disiapkan';
 const e=i.session?.evaluation;
 if(!e||['PENDING','RUNNING'].includes(e.status))return 'Menilai hasil';
 if(e.status==='FAILED')return 'Penilaian gagal';
 return e.status==='NEEDS_REVIEW'||e.result?.voice?.partial?'Hasil parsial':'Hasil tersedia';
}
export function coverage(i:Invitation){const r=i.session?.evaluation?.result;if(!r||r.taraInterview?.topics.some(topic=>topic.alternative)||!r.voice&&!r.claims?.length)return null;return r.voice?{tested:r.voice.testedClaims,total:r.voice.totalClaims}:{tested:r.claims?.filter(c=>c.asked!==false&&c.score!=null).length??0,total:r.claims?.length??0};}
export function turns(report:Report):Turn[]{
 if(report.voice)return report.voice.transcript;
 const first=report.questions.find(q=>q.shownAt)?.shownAt;
 const offset=(s:string|null|undefined)=>s&&first?Math.max(0,Date.parse(s)-Date.parse(first)):null;
 return report.questions.flatMap(q=>[{id:'question:'+q.id,speaker:'TARA',text:q.text,startMs:offset(q.shownAt)},{id:'answer:'+q.id,speaker:'CANDIDATE',text:q.answer?.trim()||'Tidak ada jawaban tersimpan.',startMs:offset(q.answeredAt),timedOut:q.timedOut}]);
}
