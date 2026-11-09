import 'reflect-metadata';
import fs from 'node:fs';
import {renderScreeningReport} from './screening-report';
async function main(){
 const names=['Mengembangkan model forecasting','Mengevaluasi hasil model','Mengolah data curah hujan','Memimpin proyek lintas tim','Membangun pipeline produksi','Merancang asisten klaim kesehatan'];
 const claims=names.map((statement,i)=>({id:'claim-'+i,statement,quote:statement+' untuk analisis data.'}));
 const result={summary:'Kontribusi pada EDA sudah disebutkan. Langkah kerja, hasil, dan tanggung jawab pribadi masih perlu didalami. Dua klaim belum diuji.',strengths:['Kontribusi pada EDA dijelaskan.'],gaps:['Langkah dan tanggung jawab pribadi perlu didalami.'],interviewQuestions:['Perjelas langkah EDA yang dilakukan sendiri.','Konfirmasikan evaluasi hasil forecasting.','Dalami validasi rekomendasi asisten klaim.'],criteria:[],voice:{partial:true,testedClaims:4,totalClaims:6,durationSeconds:229,transcriptComplete:false},claims:claims.map((c,i)=>({claimId:c.id,score:i===3||i===4?null:i===1?0:2,asked:i!==3&&i!==4,status:'INSUFFICIENT',reason:'Penjelasan masih perlu didalami.',evidence:i===3||i===4?[]:[{questionId:'q'+i,quote:i===0?'Saya lebih banyak membantu di bagian EDA.':i===1?'Saya sudah agak lupa langkah konkretnya.':'Saya memeriksa periode dataset dan kelengkapan data.'}],contradictions:[]}))};
 const pdf=await renderScreeningReport({name:'Dinda Pramesti',job:'Machine Learning Engineer',company:'Lintas Awan Teknologi',submittedAt:new Date('2026-11-09T09:43:00Z'),methodology:'tara-voice-v2',jobVersion:1,cvScore:60,screeningScore:37.5,finalScore:null,independentScores:true,result:result as any,plan:{claims} as any,rubric:{criteria:[]} as any});
 fs.mkdirSync('output/pdf',{recursive:true});fs.writeFileSync('output/pdf/screening-design-fixture.pdf',pdf);console.log('Screening design PDF fixture generated. Paid AI calls: 0.');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
