import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JobPaymentProvider,midtransState } from '../benefits/job-payment.provider';
import { effectiveExperience } from './job-input';
import { SENIORITY_LEVELS } from '../catalogs/business-catalog.data';
import { candidateExperienceReference } from '../matching/employee-experience-policy';
import { vacancyTaskText } from '../matching/vacancy-tasks';
import { creationDraftSchema } from './hr-flow.controller';
import { isDocxPackage } from './document-upload';
import { evaluateEmployee,OccupationIndex } from '../matching/employee-matching';
let assertions=0;
const equal=(actual:unknown,expected:unknown)=>{assert.deepEqual(actual,expected);assertions++;};
async function run(){
 equal(isDocxPackage(Buffer.from('PK fake renamed document')),false);
 equal(isDocxPackage(Buffer.from('%PDF-1.4')),false);
 const Zip=require('node:module').createRequire(require.resolve('mammoth'))('jszip');
 const zip=new Zip();zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
 const packageBytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 equal(isDocxPackage(packageBytes),true);equal(isDocxPackage(packageBytes.subarray(0,packageBytes.length-5)),false);
 const ordinaryZip=new Zip();ordinaryZip.file('other.txt','Not a Word document');equal(isDocxPackage(await ordinaryZip.generateAsync({type:'nodebuffer'})),false);
 const oldExperienceFlag=process.env.EMPLOYEE_EXPERIENCE_POLICY_ENABLED;
 try{
  const index=new OccupationIndex([{id:'role',name:'Developer',normalizedKey:'developer',aliases:[]}]);
  const candidate={id:'fixture',headline:'Developer',skills:[],languages:[],experiences:[{title:'Developer',startDate:new Date('2010-01-01'),endDate:new Date('2025-01-01'),isCurrent:false}]};
  const posting={id:'job',companyId:'company',title:'Developer',jobTitleId:'role',workMode:'REMOTE',jobSkills:[],jobLanguages:[],experienceYearsMin:50,seniorityLevelCode:'L6',seniorityVersion:'test',seniorityYearsMin:10,seniorityYearsMax:15,experienceRangeMin:3,experienceRangeMax:5,experienceRangeSource:'EMPLOYER_ADJUSTED'};
  process.env.EMPLOYEE_EXPERIENCE_POLICY_ENABLED='false';const legacy=evaluateEmployee(candidate,posting,index,new Date('2026-01-01'));
  process.env.EMPLOYEE_EXPERIENCE_POLICY_ENABLED='true';const active=evaluateEmployee(candidate,posting,index,new Date('2026-01-01'));
  equal(active.positiveCore,legacy.positiveCore);equal(active.score>legacy.score,true);
  const evidence=active.insights.evidence.find(e=>e.kind==='EXPERIENCE')!;equal(evidence.status,'MET');equal(evidence.required,false);equal(evidence.experienceReference?.source,'EMPLOYER_ADJUSTED');
  const unknown=evaluateEmployee({...candidate,experiences:[]},posting,index);equal(unknown.insights.evidence.find(e=>e.kind==='EXPERIENCE')?.status,'UNKNOWN');equal(unknown.positiveCore,true);
  equal(evaluateEmployee(candidate,{...posting,experienceRangeMax:50},index).score,active.score);
  const unreviewed=evaluateEmployee(candidate,{...posting,positionEntryMode:'MANUAL',jobTitleId:null},index);equal(unreviewed.positiveCore,false);equal(unreviewed.score,0);
 }finally{if(oldExperienceFlag===undefined)delete process.env.EMPLOYEE_EXPERIENCE_POLICY_ENABLED;else process.env.EMPLOYEE_EXPERIENCE_POLICY_ENABLED=oldExperienceFlag;}
 for(const level of SENIORITY_LEVELS){
  const snapshot={seniorityLevelCode:level.code,seniorityYearsMin:level.yearsMin,seniorityYearsMax:level.yearsMax,seniorityVersion:level.version};
  const range=effectiveExperience({seniorityLevelCode:level.code},snapshot);
  equal(range,{experienceRangeMin:level.yearsMin,experienceRangeMax:level.yearsMax,experienceRangeSource:'CATALOG_DERIVED'});
  const adjusted=effectiveExperience({seniorityLevelCode:level.code,experienceRangeMin:1,experienceRangeMax:50},snapshot);
  const reference=candidateExperienceReference({experienceYearsMin:49,...snapshot,...adjusted},true);
  equal(reference.minimum,1);equal(reference.required,false);equal(reference.maximum,50);
  equal(candidateExperienceReference({experienceYearsMin:7,...snapshot,...adjusted},false).minimum,7);
 }
 for(const input of [{seniorityLevelCode:'L6',experienceRangeMin:-1},{seniorityLevelCode:'L6',experienceRangeMin:51},{seniorityLevelCode:'L6',experienceRangeMin:2.5},{seniorityLevelCode:'L6',experienceRangeMin:10,experienceRangeMax:5},{seniorityLevelCode:null,experienceRangeMin:1}]){assert.throws(()=>effectiveExperience(input,{seniorityLevelCode:'L6',seniorityYearsMin:10,seniorityYearsMax:15}));assertions++;}
 equal(effectiveExperience({},{}),{});
 equal(effectiveExperience({seniorityLevelCode:null},{}),{experienceRangeMin:null,experienceRangeMax:null,experienceRangeSource:null});
 equal(vacancyTaskText({description:'Main duties',responsibilities:['First responsibility','Second responsibility']}),'Main duties\nResponsibilities\nFirst responsibility\nSecond responsibility');
 for(const field of ['_senioritySnapshot','experienceRangeSource','seniorityVersion','seniorityYearsMin','screeningQuestions','isAnonymous','experienceLevel','experienceYearsMin']){equal(creationDraftSchema.safeParse({[field]:field==='isAnonymous'?true:'spoofed'}).success,false);}
 equal(creationDraftSchema.safeParse({title:'',description:'',kpis:[''],responsibilities:['']}).success,true);
 equal(creationDraftSchema.safeParse({title:'Staff Accountant',positionEntryMode:'MANUAL'}).success,true);
 for(const [status,fraud,expected] of [['settlement','','PAID'],['capture','accept','PAID'],['capture','challenge','REVIEW'],['pending','','PENDING'],['expire','','EXPIRED'],['cancel','','CANCELLED'],['deny','','FAILED'],['refund','','REVIEW']] as const)equal(midtransState({transaction_status:status,fraud_status:fraud}),expected);
 const originalFetch=globalThis.fetch,oldEnv={mode:process.env.MIDTRANS_ENV,key:process.env.MIDTRANS_SERVER_KEY,checkout:process.env.MIDTRANS_CHECKOUT_ENABLED};
 process.env.MIDTRANS_ENV='sandbox';process.env.MIDTRANS_SERVER_KEY='unit-only-not-a-real-key';
 process.env.MIDTRANS_CHECKOUT_ENABLED='true';
 const provider=new JobPaymentProvider();let calls=0;
 const event={order_id:'test-order-1',transaction_id:'provider-1',transaction_status:'settlement',status_code:'200',gross_amount:'149000.00',currency:'IDR'};
 globalThis.fetch=async(input,options)=>{calls++;const url=String(input);assert.ok(url.startsWith('https://api.sandbox.midtrans.com/')||url.startsWith('https://app.sandbox.midtrans.com/'));assertions++;return new Response(JSON.stringify(url.includes('/snap/')?{redirect_url:'https://app.sandbox.midtrans.com/snap/v4/redirection/test'}:event),{status:200,headers:{'content-type':'application/json'}});};
 try{
  const signature=createHash('sha512').update(event.order_id+event.status_code+event.gross_amount+process.env.MIDTRANS_SERVER_KEY).digest('hex');
  const verified=await provider.verify({},Buffer.from(JSON.stringify({...event,signature_key:signature})));
  equal(verified.amount,149000);equal(verified.status,'PAID');equal(verified.reference,'provider-1');
  await assert.rejects(()=>provider.verify({},Buffer.from(JSON.stringify({...event,signature_key:'0'.repeat(128)}))));assertions++;equal(calls,1);
  await assert.rejects(()=>provider.verify({},Buffer.from('{broken')));assertions++;
  const checkout=await provider.checkout({id:event.order_id,amount:149000,currency:'IDR',createdAt:new Date(),expiresAt:new Date(Date.now()+3600000)});
  equal(new URL(checkout.redirectUrl).hostname,'app.sandbox.midtrans.com');
  await assert.rejects(()=>provider.checkout({id:'invalid/order',amount:149000,currency:'IDR',createdAt:new Date(),expiresAt:new Date(Date.now()+3600000)}));assertions++;
  globalThis.fetch=async()=>new Response(JSON.stringify({redirect_url:'https://evil.invalid/checkout'}),{status:200});
  await assert.rejects(()=>provider.checkout({id:event.order_id,amount:149000,currency:'IDR',createdAt:new Date(),expiresAt:new Date(Date.now()+3600000)}));assertions++;
  process.env.MIDTRANS_CHECKOUT_ENABLED='false';const disabled=new JobPaymentProvider();equal(disabled.available,false);equal(disabled.configured,true);
  globalThis.fetch=async()=>new Response(JSON.stringify(event),{status:200});equal((await disabled.queryStatus(event.order_id)).status,'PAID');
  await assert.rejects(()=>disabled.checkout({id:event.order_id,amount:149000,currency:'IDR',createdAt:new Date(),expiresAt:new Date(Date.now()+3600000)}));assertions++;
 }finally{globalThis.fetch=originalFetch;if(oldEnv.mode===undefined)delete process.env.MIDTRANS_ENV;else process.env.MIDTRANS_ENV=oldEnv.mode;if(oldEnv.key===undefined)delete process.env.MIDTRANS_SERVER_KEY;else process.env.MIDTRANS_SERVER_KEY=oldEnv.key;if(oldEnv.checkout===undefined)delete process.env.MIDTRANS_CHECKOUT_ENABLED;else process.env.MIDTRANS_CHECKOUT_ENABLED=oldEnv.checkout;}
 console.log(JSON.stringify({suite:'hr-flow-unit',assertions,seniorityLevels:14,liveProviderTransactions:0}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
