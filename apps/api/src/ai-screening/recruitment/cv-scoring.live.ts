// Explicit opt-in only. One small synthetic PDF and one Responses call, using a disposable local DB.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ScreeningClient,AiPending } from '../screening.client';
import { composePrompt } from '../prompts/compose';
import { CV_RUBRIC,validateCvResult } from './cv-scoring.policy';
async function main(){
 if(process.env.RECRUITMENT_LIVE_CV!=='1'||!process.env.OPENAI_API_KEY||!process.env.DATABASE_URL?.includes('/talentio_recruitment_it_'))throw Error('Explicit live-test and disposable DB required');
 const db=new PrismaService();await db.$connect();
 try{
 const doc=new PDFDocument(),chunks:Buffer[]=[];doc.on('data',chunk=>chunks.push(chunk));const ready=new Promise<Buffer>((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.fontSize(18).text('Dinda Pramesti - Backend Developer');doc.moveDown().fontSize(11).text('Email: dinda@example.test\nPhone: +6281234567890\n\nPengalaman: Backend Developer, Studio Nusantara, 2023-2026.\nMembangun REST API menggunakan Node.js, TypeScript dan PostgreSQL.\nMenulis pengujian integrasi untuk endpoint pembayaran dan dokumentasi OpenAPI.\nPendidikan: S1 Informatika, 2023.');doc.end();const pdf=await ready;
 const input={job:{title:'Backend Developer',description:'Membangun REST API dengan TypeScript, Node.js dan PostgreSQL. Menulis pengujian integrasi dan dokumentasi API.',experienceYearsMin:2,skills:[{name:'TypeScript',required:true}]},rubric:CV_RUBRIC,language:'id'};
 const config=new ConfigService(process.env),client=new ScreeningClient(db,config),{input:_input,...preset}=composePrompt('cv-score',input);
 let value:unknown,done=false;const started=Date.now(),work='live-cv-'+started;
 while(Date.now()-started<180000){try{value=await client.run(work,'synthetic-candidate','cv-score',input,{...preset,model:'gpt-6-luna'},[{filename:'CV-Dinda-Synthetic.pdf',file_data:'data:application/pdf;base64,'+pdf.toString('base64')}]);done=true;break;}catch(e){if(!(e instanceof AiPending))throw e;await new Promise(resolve=>setTimeout(resolve,1500));}}
 if(!done)throw Error('LIVE_CV_TIMEOUT');
 const result=validateCvResult(value,true);assert.equal(result.result.readable,true);assert.equal(result.result.fullName,'Dinda Pramesti');assert.equal(result.result.criteria.length,3);assert.ok(typeof result.score==='number');
 const calls=await db.aiScreeningCall.findMany({where:{workId:work},select:{model:true,status:true,inputTokens:true,outputTokens:true,cachedTokens:true}});assert.equal(calls.length,1);
 console.log(JSON.stringify({test:'native-CV-scoring-live',score:result.score,calls}));
 }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Live CV failed');process.exitCode=1;});
