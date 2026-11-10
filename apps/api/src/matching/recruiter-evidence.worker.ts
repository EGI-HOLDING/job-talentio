import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { extractCvText } from '../profiles/parse/cv-text-extract';
import { hrEnabled, HR_PARSER, hrHash, parseHrEvidence } from './recruiter-ranking';
import { loadHrCatalog, invalidateHrRanking } from './recruiter-ranking.service';
import { historicalHrSubmission } from './recruiter-evidence';

@Injectable()
export class RecruiterEvidenceWorker implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private working=false;
  constructor(private db:PrismaService,private storage:StorageService,private config:ConfigService){}
  onModuleInit(){if(!hrEnabled())return;const run=()=>void this.recover().catch(e=>new Logger('HrEvidence').warn(e.message));run();this.timer=setInterval(run,5000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async recover(){
    if(this.working||!hrEnabled())return;this.working=true;
    try{
      const catalog=await loadHrCatalog(this.db);
      // Recover historical bindings from their submitted file, never from today's library file.
      const historical=await this.db.application.findMany({where:{profile:{user:{anonymizedAt:null}},OR:[{hrSubmissionSnapshot:{equals:Prisma.DbNull}},{AND:[{resumeVersionId:null},{OR:[{hrSubmissionSnapshot:{path:['fileKey'],string_contains:''}},{resumeSnapshot:{path:['resume','fileKey'],string_contains:''}}]}]}]},take:25,include:{resumeVersion:true},orderBy:{id:'asc'}});
      for(const row of historical){const snapshot=historicalHrSubmission(row);let version=row.resumeVersion;
        if(!version&&snapshot.fileKey){const id='hrcv_'+hrHash([row.id,snapshot.fileKey]);version=await this.db.resumeVersion.upsert({where:{id},create:{id,fileKey:snapshot.fileKey,parseStatus:'PENDING'},update:{}});snapshot.versionId=version.id;}
        await this.db.application.updateMany({where:{id:row.id,hrSubmissionSnapshot:{equals:Prisma.DbNull}},data:{hrSubmissionSnapshot:JSON.parse(JSON.stringify(snapshot)),...(version?{resumeVersionId:version.id}:{})}});
        if(version)await this.db.application.updateMany({where:{id:row.id,resumeVersionId:null},data:{resumeVersionId:version.id}});
      }
      const versions=await this.db.resumeVersion.findMany({where:{OR:[{applications:{some:{}}},{currentFor:{is:{isPrimary:true,deletedAt:null,fileKey:{not:null},profile:{user:{isBanned:false,anonymizedAt:null}}}}}],recruiterEvidence:{none:{parserVersion:HR_PARSER,catalogRevision:catalog.revision}}},take:25,orderBy:{id:'asc'}});
      if(versions.length)await this.db.resumeRecruiterEvidence.createMany({data:versions.map(v=>({versionId:v.id,parserVersion:HR_PARSER,catalogRevision:catalog.revision,generation:v.parseGeneration})),skipDuplicates:true});
      const stale=await this.db.resumeRecruiterEvidence.findMany({where:{parserVersion:HR_PARSER,catalogRevision:catalog.revision},include:{version:{select:{parseGeneration:true}}}});
      for(const row of stale)if(row.generation!==row.version.parseGeneration)await this.db.resumeRecruiterEvidence.updateMany({where:{id:row.id,generation:row.generation,revision:row.revision},data:{generation:row.version.parseGeneration,status:'PENDING',startedAt:null,revision:{increment:1}}});
      await this.db.resumeRecruiterEvidence.updateMany({where:{status:'PROCESSING',startedAt:{lt:new Date(Date.now()-240000)}},data:{status:'PENDING',startedAt:null,revision:{increment:1}}});
      const pending=await this.db.resumeRecruiterEvidence.findMany({where:{status:'PENDING',parserVersion:HR_PARSER,catalogRevision:catalog.revision},take:2,orderBy:{createdAt:'asc'}});
      for(const row of pending)await this.process(row.id);
    }finally{this.working=false;}
  }
  async process(id:string){
    const [claim]=await this.db.resumeRecruiterEvidence.updateManyAndReturn({where:{id,status:'PENDING'},data:{status:'PROCESSING',startedAt:new Date()}});if(!claim)return;
    const guard={id,generation:claim.generation,revision:claim.revision,status:'PROCESSING'};
    try{
      const version=await this.db.resumeVersion.findUniqueOrThrow({where:{id:claim.versionId},include:{resume:{include:{profile:{select:{user:{select:{fullName:true}}}}}},applications:{take:1,select:{profile:{select:{user:{select:{fullName:true}}}}}}}});
      const catalog=await loadHrCatalog(this.db);if(catalog.revision!==claim.catalogRevision)return;
      const buffer=await this.storage.getObjectBuffer(version.fileKey);
      const checksum=createHash('sha256').update(buffer).digest('hex');
      const parserConfig={get:(key:string)=>key==='CV_PARSE_OCR_LANGS'?this.config.get('HR_CV_OCR_LANGS','eng+ind'):this.config.get(key)} as ConfigService;
      const extracted=await extractCvText({buffer,filename:version.fileKey,mimeType:version.fileKey.toLowerCase().endsWith('.pdf')?'application/pdf':'application/octet-stream'},parserConfig);
      const facts=parseHrEvidence(extracted.text,catalog,version.resume?.profile.user??version.applications[0]?.profile.user);
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "ResumeVersion" WHERE id=${version.id} FOR UPDATE`);
        const current=await tx.resumeVersion.findUniqueOrThrow({where:{id:version.id}});
        if(current.parseGeneration!==claim.generation||current.fileKey!==version.fileKey)return;
        await tx.resumeRecruiterEvidence.updateMany({where:guard,data:{facts:JSON.parse(JSON.stringify(facts)),checksum,status:'READY',error:null,startedAt:null,revision:{increment:1}}});
      });
    }catch(error){const unavailable=['NoSuchKey','NotFound'].includes((error as Error).name);await this.db.resumeRecruiterEvidence.updateMany({where:guard,data:{status:unavailable?'UNAVAILABLE':'FAILED',error:(error as Error).message.slice(0,300),startedAt:null,revision:{increment:1}}});}
    finally{invalidateHrRanking();}
  }
}
