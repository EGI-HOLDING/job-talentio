/** Synthetic, opt-in presentation fixtures. Never imported by seed/startup. */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import PDFDocument from 'pdfkit';
import { PrismaClient, Prisma } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { ApplicationsService } from '../applications/applications.service';
import { BenefitsService } from '../benefits/benefits.service';
import { HrSupportService } from '../benefits/hr-support.service';
import { StorageService } from '../storage/storage.service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { AuthUser } from '../common/auth.decorators';

const DAY=86400000, now=new Date(), at=(days:number,minutes=0)=>new Date(now.getTime()+days*DAY+minutes*60000);
const directory=process.env.HR_DEMO_DIRECTORY!;
const target=new URL(process.env.DATABASE_URL!);
assert.equal(process.env.DATABASE_URL,process.env.HR_DEMO_DATABASE_URL);
assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/talentio_hr_demo');
assert.equal(process.env.S3_BUCKET,'talentio-hr-demo');
const credentials=JSON.parse(fs.readFileSync(path.join(directory,'credentials.json'),'utf8'));
const roles=[
  {title:'Operations Supervisor',skills:['Operations Management','Team Leadership','Inventory Management','Excel'],description:'Lead daily operations, coordinate a team across shifts, track inventory accuracy and improve standard operating procedures.'},
  {title:'Frontend Developer',skills:['JavaScript','React','CSS','Git'],description:'Build accessible customer interfaces in React, collaborate with product designers, write reliable components and improve application performance.'},
  {title:'Sales Executive',skills:['Sales','Negotiation','Customer Relationship Management','Communication'],description:'Develop customer relationships, qualify opportunities, prepare proposals and negotiate contracts while maintaining accurate sales records.'},
  {title:'Accountant',skills:['Accounting','Excel','Financial Reporting','Reconciliation'],description:'Prepare financial statements, reconcile accounts, maintain reliable transaction records and coordinate monthly reporting and controls.'},
  {title:'HR Specialist',skills:['Recruitment','Interviewing','Communication','Excel'],description:'Coordinate recruitment and onboarding, maintain employee records and work with hiring managers to improve the candidate experience.'},
  {title:'Data Engineer',skills:['SQL','Python','Data Modeling','ETL'],description:'Build dependable data pipelines, validate data quality, design analytical models and collaborate with reporting teams on trusted datasets.'},
  {title:'Warehouse Supervisor',skills:['Inventory Management','Logistics','Team Leadership','Excel'],description:'Supervise warehouse receiving and dispatch, lead safe shift operations and improve stock accuracy and delivery coordination.'},
  {title:'Customer Service Representative',skills:['Communication','Customer Support','Problem Solving','CRM'],description:'Resolve customer questions, document cases, coordinate with operations and maintain a helpful and accurate support experience.'},
  {title:'Logistics Coordinator',skills:['Logistics','Planning','Excel','Communication'],description:'Coordinate shipments, monitor delivery schedules, prepare transport documentation and resolve operational issues with carriers.'},
  {title:'Retail Store Manager',skills:['Retail Operations','Sales','Team Leadership','Inventory Management'],description:'Lead store performance, coach retail colleagues, maintain stock availability and deliver a consistent customer shopping experience.'},
];
const plans=[
  {name:'Nusantara Digital',slug:'demo-nusantara-digital',code:'PREMIUM',iso:'ID',city:'Jakarta',jobs:[0,1,2,3,4,5,7,6,8,9],counts:[80,35,30,20,15,10,0,8,7,5]},
  {name:'Silk Road Logistics',slug:'demo-silk-road-logistics',code:'STANDARD',iso:'UZ',city:'Tashkent',jobs:[6,8,3,7],counts:[20,15,15,10]},
  {name:'Meridian Retail',slug:'demo-meridian-retail',code:'FREE',iso:'ID',city:'Bandung',jobs:[9,2,7],counts:[20,12,8]},
] as const;
const firstId=['Rina','Dimas','Maya','Farid','Sari','Bima','Nadia','Rizky','Putri','Arif','Dewi','Fajar','Intan','Andi','Ratna','Hendra','Lestari','Bayu','Nina','Yoga'];
const lastId=['Pratama','Santoso','Wijaya','Rahman'];
const firstUz=['Aziz','Malika','Jasur','Dilnoza','Bobur','Shahnoza','Akmal','Lola','Nodir','Madina','Bekzod','Sevara','Rustam','Zarina','Sardor','Nargiza','Timur','Gulnoza','Alisher','Zuhra'];
const lastUz=['Karimov','Yusupov','Abdullayev','Tursunov'];
function roleFor(i:number){return i<48?roles[0]:roles[1+(i-48)%9];}
async function pdf(name:string,role:typeof roles[number],index:number,version='Submitted CV'){
  const document=new PDFDocument({size:'A4',margin:48});const chunks:Buffer[]=[];
  const result=new Promise<Buffer>((resolve,reject)=>{document.on('data',c=>chunks.push(c));document.on('end',()=>resolve(Buffer.concat(chunks)));document.on('error',reject);});
  document.fontSize(11).fillColor('#65758b').text('TALENTIO DEMO | SYNTHETIC CANDIDATE | '+version);
  document.moveDown().fillColor('#111b35').fontSize(26).text(name).fontSize(16).text(role.title);
  document.moveDown().fontSize(11).text('Email: candidate'+index+'@demo.talentio.test');
  document.text('Location: '+(index%2?'Tashkent, Uzbekistan':'Jakarta, Indonesia'));
  for(const[heading,body]of [['Professional summary',role.description],['Skills',role.skills.join(', ')],['Experience',(2019+index%4)+' - Present | '+role.title+' | Contoh Karya / Namuna Ish (synthetic employer)\n'+role.description],['Education','Bachelor degree | Demo Learning Institute | 2015 - 2019'],['Languages',index%2?'Uzbek (native), English (B2)':'Indonesian (native), English (B2)']]){document.moveDown().fillColor('#5133ef').fontSize(13).text(heading).fillColor('#283b52').fontSize(11).text(body);}
  document.moveDown().fontSize(9).fillColor('#65758b').text('This document is fictional demonstration data. It does not represent a real person.');document.end();return result;
}
async function main(){
  const pre=new PrismaClient();await pre.$connect();
  const manifestPath=path.join(directory,'manifest.json');
  if(await pre.user.count()){
    if(fs.existsSync(manifestPath)&&JSON.parse(fs.readFileSync(manifestPath,'utf8')).database==='talentio_hr_demo'){
      assert.equal(await pre.company.count(),3);assert.equal(await pre.jobPost.count(),17);assert.equal(await pre.application.count(),310);
      console.log('Existing complete demo retained; use restore to undo presentation actions.');await pre.$disconnect();return;
    }
    throw Error('Demo database contains incomplete/unknown data; refusing to overwrite it');
  }
  const source=new PrismaClient({datasources:{db:{url:process.env.HR_DEMO_SOURCE_URL}}});await source.$connect();
  const catalog=['country','province','city','cityAlias','jobCategory','industryGroup','industry','skill','skillAlias','language','languageAlias','benefit','benefitAlias','jobTitle','jobTitleAlias'];
  const sourceCounts:Record<string,number>={};
  for(const model of catalog){const rows=await (source as any)[model].findMany();sourceCounts[model]=rows.length;if(rows.length)await (pre as any)[model].createMany({data:rows,skipDuplicates:true});}
  await source.$disconnect();
  const passwordHash=await bcrypt.hash(credentials.password,12);
  const account=async(key:string,role:any,fullName:string)=>pre.user.create({data:{email:credentials.accounts[key],passwordHash,fullName,role,locale:'id',emailVerified:true}});
  const hr=await account('hr','RECRUITER','Alya — HR Demo'),admin=await account('admin','SUPER_ADMIN','Admin Demo'),hr2=await account('secondHr','RECRUITER','Bima — HR Team'),outsider=await account('outsider','RECRUITER','HR Pemeriksa Akses');
  await pre.$disconnect();
  const app=await NestFactory.createApplicationContext(AppModule,{logger:['error','warn']});
  const db=app.get(PrismaService),jobs=app.get(JobsService),applications=app.get(ApplicationsService),benefits=app.get(BenefitsService),support=app.get(HrSupportService);
  await app.get(StorageService).onModuleInit();
  const s3=new S3Client({region:'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY!,secretAccessKey:process.env.S3_SECRET_KEY!}});
  const files:Array<{key:string;bytes:number;type:string;sha256:string}>=[];
  async function upload(key:string,body:Buffer,type:string){
    assert.ok(!key.includes('..')&&/^(cvs|public)\/demo\//.test(key));
    const local=path.join(directory,'objects',key);fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,body);
    await s3.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:body,ContentType:type}));files.push({key,bytes:body.length,type,sha256:createHash('sha256').update(body).digest('hex')});
  }
  try{
    await benefits.rollout(admin as AuthUser,'demo-rollout');
    for(const key of ['hr_packages','hr_promotions','hr_analytics','hr_support'])await db.featureFlag.upsert({where:{key},create:{key,enabled:true},update:{enabled:true}});
    const countries=await db.country.findMany({where:{iso2:{in:['ID','UZ']}}});
    assert.equal(countries.length,2,'Approved ID and UZ catalog must already exist');
    const cities=await db.city.findMany({where:{archivedAt:null,province:{countryId:{in:countries.map(c=>c.id)}}},include:{province:true}});
    const cityFor=(iso:string,search:string)=>{const country=countries.find(c=>c.iso2===iso)!;const city=cities.find(c=>c.province.countryId===country.id&&[c.name,c.nameId,c.nameUz,c.slug].some(n=>n?.toLowerCase().includes(search.toLowerCase())));assert.ok(city,'Missing catalog city '+search);return city;};
    const idCity=cityFor('ID','Jakarta'),uzCity=cityFor('UZ','Tashkent');
    const employees:any[]=[];
    const languages=await db.language.findMany({where:{code:{in:['en','id','uz']}}});
    // Skills are real input on synthetic jobs, resolved through the production service.
    const companyRecords:any[]=[];const jobRecords:any[]=[];
    for(let c=0;c<plans.length;c++){
      const plan=plans[c],city=cityFor(plan.iso,plan.city);
      const company=await db.company.create({data:{name:plan.name,slug:plan.slug,locale:c===1?'uz':'id',description:'Perusahaan fiktif untuk demonstrasi Talentio. Synthetic demonstration company — '+plan.name+'.',cityId:city.id,isVerified:true,members:{create:[{userId:hr.id,role:'OWNER'},...(c===0?[{userId:hr2.id,role:'RECRUITER' as const}]:[]),...(c===2?[{userId:outsider.id,role:'RECRUITER' as const}]:[])]}}});
      companyRecords.push({...company,package:plan.code});
      const canvas=await import('@napi-rs/canvas');const logo=canvas.createCanvas(192,192),ctx=logo.getContext('2d');ctx.fillStyle=['#5333ef','#087e8b','#bc5722'][c];ctx.fillRect(0,0,192,192);ctx.fillStyle='#ffffff';ctx.font='bold 64px Arial';ctx.textAlign='center';ctx.fillText(['ND','SL','MR'][c],96,118);const key='public/demo/logos/'+company.id+'.png';await upload(key,logo.toBuffer('image/png'),'image/png');await db.company.update({where:{id:company.id},data:{logoUrl:process.env.S3_PUBLIC_URL+'/'+key}});
      for(let j=0;j<plan.jobs.length;j++){
        const role=roles[plan.jobs[j]],draft=c===0&&j===6;
        const job=await jobs.create(hr as AuthUser,company.id,{title:role.title,description:role.description+'\n\nAbout the team\n'+plan.name+' is building dependable services across its market. This is a fictional vacancy prepared for a product demonstration.\n\nResponsibilities\n'+role.skills.map(s=>'- Apply '+s+' in daily work.').join('\n')+'\n\nWe welcome clear communication and evidence of practical experience.',locale:'en',citySlug:city.slug,countryId:city.province.countryId,workMode:j===5?'REMOTE':'ONSITE',employmentType:'FULL_TIME',currency:plan.iso==='ID'?'IDR':'UZS',salaryMin:plan.iso==='ID'?8000000:7000000,salaryMax:plan.iso==='ID'?14000000:12000000,experienceYearsMin:2,experienceLevel:'MIDDLE',skills:role.skills.map(name=>({name,isRequired:true,weight:1}))});
        assert.ok(job);
        if(plan.code!=='FREE')await benefits.grant(admin as AuthUser,job.id,plan.code,'Synthetic local demo package; no payment','demo-grant-'+job.id);
        const question=await jobs.addQuestion(hr as AuthUser,job.id,{question:'Tell us about a relevant project or responsibility.',type:'TEXT',isRequired:true});
        if(!draft)await jobs.changeStatus(hr as AuthUser,job.id,'PUBLISHED');
        const publishedAt=at(c===0&&j===9?-35:-18);
        await db.jobPost.update({where:{id:job.id},data:{createdAt:at(-20),...(!draft?{publishedAt}:{} )}});
        if(!draft)await db.jobBenefit.update({where:{jobId:job.id},data:{startsAt:publishedAt,expiresAt:c===0&&j===9?at(1):new Date(publishedAt.getTime()+30*DAY)}});
        jobRecords.push({id:job.id,companyId:company.id,companyIndex:c,index:j,title:role.title,roleIndex:plan.jobs[j],questionId:question.id,count:plan.counts[j],package:plan.code,draft});
      }
    }
    console.log('Three companies and 17 jobs created through job and benefit services.');
    const allSkills=await db.skill.findMany();
    for(let i=0;i<160;i++){
      const uz=i%2===1,seq=Math.floor(i/2),name=uz?firstUz[seq%20]+' '+lastUz[Math.floor(seq/20)]:firstId[seq%20]+' '+lastId[Math.floor(seq/20)];
      const user=await db.user.create({data:{email:i===0?credentials.accounts.employee:'candidate'+i+'@demo.talentio.test',passwordHash,fullName:name,role:'EMPLOYEE',locale:uz?'uz':i%3?'id':'en',emailVerified:true}});
      const role=roleFor(i),city=uz?uzCity:idCity,skillSubset=i===0?role.skills:i%13===0?[]:role.skills.slice(0,2+i%3),countryId=city.province.countryId;
      const profile=await db.employeeProfile.create({data:{userId:user.id,headline:role.title,desiredPosition:role.title,desiredPositions:[role.title],summary:role.description,contentLocale:'en',cityId:i%17?city.id:null,residenceCountryId:countryId,visibility:i%19===0?'PRIVATE':'TO_REGISTERED_RECRUITERS',onboardingStatus:'COMPLETED',onboardingStep:5,onboardingCompletedAt:at(-25),bulkCommsOptOut:i===19,skills:{create:skillSubset.map(name=>{const skill=allSkills.find(s=>s.name.toLowerCase()===name.toLowerCase());assert.ok(skill,name);return{skillId:skill.id,level:'ADVANCED',levelSource:'USER_CONFIRMED'};})},experiences:i%11?{create:{title:role.title,companyName:uz?'Namuna Ish':'Contoh Karya',description:role.description,countryId,cityId:city.id,startDate:new Date(Date.UTC(2019+i%4,0,1)),isCurrent:true}}:undefined,educations:i%7?{create:{school:'Demo Learning Institute',degree:'BACHELOR',field:role.title,startDate:new Date('2015-09-01'),endDate:new Date('2019-06-01')}}:undefined,languages:{create:languages.filter(l=>l.code==='en'||l.code===(uz?'uz':'id')).map(l=>({languageId:l.id,level:l.code==='en'?'B2':'NATIVE'}))}}});
      let resume:any=null;
      if(i===0||i%23!==0){const key='cvs/demo/'+profile.id+'/submitted.pdf',body=await pdf(name,role,i);await upload(key,body,'application/pdf');resume=await db.resume.create({data:{profileId:profile.id,title:name+' — CV',fileKey:key,isPrimary:true,parseStatus:'NONE'}});await db.employeeProfile.update({where:{id:profile.id},data:{databaseCvEnabled:true,databaseResumeId:resume.id}});}
      employees.push({user,profile,resume,role});
    }
    const appRecords:any[]=[];
    for(const job of jobRecords){
      if(!job.count)continue;
      // Even the archived historical fixtures use real submission validation,
      // snapshots and matching. The expiry is applied after historical input.
      if(job.companyIndex===0&&job.index===9)await db.jobBenefit.update({where:{jobId:job.id},data:{expiresAt:at(1)}});
      for(let n=0;n<job.count;n++){
        const offset=job.companyIndex===0&&job.index===0?0:(job.roleIndex*13+job.companyIndex*7);
        const person=employees[1+(n+offset)%159];
        const application=await applications.apply(person.user as AuthUser,job.id,'I would like to contribute my experience in '+person.role.title+'.',[{questionId:job.questionId,answer:person.role.description}],person.resume?.id,['direct','newsletter:email','career-event','search:organic'][n%4],'en');
        const item=(application as any).application??application;
        const createdAt=at(-14+n%10,n%45),enteredAt=new Date(createdAt.getTime()+3600000);
        let status:any='NEW',entered=false;
        if(job.companyIndex===0&&job.index===0){
          status=n<20?'NEW':n<60?'IN_REVIEW':n<68?'INTERVIEW':n<72?'OFFER':n<75?'HIRED':n<78?'REJECTED':'WITHDRAWN';entered=n>=20&&n<78;
        }else{status=['NEW','IN_REVIEW','IN_REVIEW','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN'][n%8];entered=n%8>0&&n%8<7;}
        await db.application.update({where:{id:item.id},data:{createdAt,updatedAt:enteredAt,kanbanEnteredAt:entered?enteredAt:null,status}});
        if(entered)await db.auditLog.create({data:{actorId:job.companyIndex===0&&n%3===0?hr2.id:hr.id,action:'APPLICATION_KANBAN_ADDED',entityType:'Application',entityId:item.id,metadata:{synthetic:true,jobPostId:job.id},createdAt:enteredAt}});
        await db.pipelineEvent.updateMany({where:{applicationId:item.id},data:{createdAt}});
        const sequence=status==='WITHDRAWN'?['WITHDRAWN']:status==='NEW'?[]:status==='REJECTED'?['IN_REVIEW','REJECTED']:['IN_REVIEW','INTERVIEW','OFFER','HIRED'].slice(0,['IN_REVIEW','INTERVIEW','OFFER','HIRED'].indexOf(status)+1);
        for(let s=0;s<sequence.length;s++)await db.pipelineEvent.create({data:{applicationId:item.id,fromStatus:s?sequence[s-1] as any:'NEW',toStatus:sequence[s] as any,actorUserId:status==='WITHDRAWN'?person.user.id:hr.id,note:'Synthetic historical selection event',createdAt:new Date(enteredAt.getTime()+s*3600000)}});
        if(status==='INTERVIEW')await db.interview.create({data:{applicationId:item.id,scheduledAt:at(1+n%3,60*(9+n%5)),durationMins:45,location:job.companyIndex===1?'Tashkent office':'Jakarta office',note:'Synthetic interview — no external meeting invitation.'}});
        // Link the real server-submitted event to a chronological synthetic visit.
        const submit=await db.jobEvent.findFirst({where:{applicationId:item.id},include:{session:true}});
        if(submit){const start=new Date(createdAt.getTime()-10*60000),attributed=n%10!==0;await db.jobFunnelSession.update({where:{id:submit.sessionId},data:{...(attributed?{sessionKey:'demo-application-'+item.id,source:['direct','newsletter:email','career-event','search:organic'][n%4]}:{}),startedAt:start,expiresAt:new Date(start.getTime()+7*DAY)}});await db.jobEvent.update({where:{id:submit.id},data:{createdAt}});if(attributed)for(const[kind,minutes]of [['IMPRESSION',0],['DETAIL_VIEW',1],['APPLY_CLICK',3],['APPLY_START',4]] as const)await db.jobEvent.create({data:{sessionId:submit.sessionId,kind,createdAt:new Date(start.getTime()+minutes*60000)}});}
        appRecords.push({id:item.id,jobId:job.id,profileId:person.profile.id,status,entered});
      }
      console.log(job.title+': '+job.count+' historical applications');
    }
    for(const job of jobRecords){
      if(job.draft)continue;
      // Historical non-converting sessions, clearly synthetic and reconciled.
      for(let n=0;n<72;n++){
        const start=at(-14+n%14,30+n);
        await db.jobFunnelSession.create({data:{jobId:job.id,sessionKey:'demo-visit-'+job.id+'-'+n,visitorHash:'synthetic-'+n,source:['direct','newsletter:email','search:organic'][n%3],startedAt:start,expiresAt:new Date(start.getTime()+7*DAY),events:{create:[{kind:'IMPRESSION',createdAt:start},...(n%3?[{kind:'DETAIL_VIEW' as const,createdAt:new Date(start.getTime()+60000)}]:[]),...(n%5===0?[{kind:'APPLY_CLICK' as const,createdAt:new Date(start.getTime()+120000)}]:[])]}}});
      }
      if(job.companyIndex===0&&job.index===7)await jobs.changeStatus(hr as AuthUser,job.id,'PAUSED');
      if(job.companyIndex===0&&job.index===8)await jobs.changeStatus(hr as AuthUser,job.id,'CLOSED');
      if(job.companyIndex===0&&job.index===9){await db.jobBenefit.update({where:{jobId:job.id},data:{expiresAt:at(-5)}});await db.jobPost.update({where:{id:job.id},data:{status:'EXPIRED'}});}
    }
    // Current library differs from the preserved application CV for one person.
    const changed=employees[1],newKey='cvs/demo/'+changed.profile.id+'/current.pdf';await upload(newKey,await pdf(changed.user.fullName,changed.role,1,'Updated library CV — after application'),'application/pdf');await db.resume.update({where:{id:changed.resume.id},data:{title:'Updated library CV',fileKey:newKey}});
    const standard=jobRecords.find(j=>j.companyIndex===1)!;await benefits.boost(hr as AuthUser,standard.id,'demo-standard-boost');
    for(const company of companyRecords){const ticket=await support.create(hr as AuthUser,{companyId:company.id,title:'Demo: preparation for recruitment review',body:'Please help us review the recruitment report and interview workflow. Synthetic support request.'},'demo-ticket-'+company.id);await support.reply(admin as AuthUser,ticket.id,'We have received your request and are reviewing it with the HR team.','demo-reply-'+company.id);}
    for(let n=0;n<6;n++){
      const person=employees[n+1],job=jobRecords[0];const conv=await db.conversation.create({data:{userAId:hr.id,userBId:person.user.id,companyId:job.companyId,jobPostId:job.id,initiatedBy:hr.id,messages:{create:[{senderId:hr.id,body:'Hello '+person.user.fullName+', thank you for applying. Can we discuss your experience?',createdAt:at(-2)},{senderId:person.user.id,body:'Thank you. I am available to discuss the role this week.',createdAt:at(-1),deliveredAt:at(-1)}]}}});
      assert.ok(conv.id);
    }
    for(const company of companyRecords)await db.messageTemplate.create({data:{companyId:company.id,createdBy:hr.id,name:'Interview follow-up',body:'Thank you for your interest. Our team will contact you about the next interview step.'}});
    assert.equal(await db.company.count(),3);assert.equal(await db.jobPost.count(),17);assert.equal(await db.application.count(),310);assert.equal(await db.candidateCredit.count(),0);assert.equal(await db.subscription.count(),0);assert.equal(await db.payment.count(),0);
    const manifest={version:1,database:'talentio_hr_demo',preparedAt:now.toISOString(),dataNotice:'All people, companies, files and historical events are synthetic demo fixtures.',sourceCatalogCounts:sourceCounts,companies:companyRecords.map(c=>({id:c.id,name:c.name,package:c.package})),jobs:jobRecords,applicants:appRecords,files,expected:{companies:3,jobs:17,applications:310,candidates:160},employeeProfileId:employees[0].profile.id,changedCvApplicationId:appRecords.find(a=>a.profileId===changed.profile.id)?.id,heroJobId:jobRecords[0].id};
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    console.log('Demo fixtures complete: 3 companies, 17 jobs, 160 candidates, 310 applications.');
  }finally{await app.close();s3.destroy();}
}
// AppModule's legacy alert scheduler keeps sockets alive after app.close().
// This one-shot fixture command has finished all awaited writes and closes its
// own process so it can never keep consuming a demo queue in the background.
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
