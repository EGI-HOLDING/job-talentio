import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { withCvFacts } from './cv-evidence';
import { submittedResume } from '../applications/application-payload';

/** Resolve historical files by the submitted key, never today's primary CV. */
export async function applicationCvProfile<T extends {id:string}>(db:Prisma.TransactionClient,application:{id:string;resumeId:string|null;resumeVersionId:string|null;resumeSnapshot:unknown;resumeVersion?:{id:string;parseStatus:string;matchingData:unknown}|null},profile:T) {
  const snapshot=(application.resumeSnapshot??{}) as Record<string,any>;
  let version=application.resumeVersion??(application.resumeVersionId?await db.resumeVersion.findUnique({where:{id:application.resumeVersionId}}):null);
  if(!version && application.resumeId){
    const submitted=submittedResume(snapshot);
    if(submitted.fileKey){
      // Do not change Resume.currentVersionId while recovering an application.
      version=await db.resumeVersion.upsert({where:{resumeId_fileKey:{resumeId:application.resumeId,fileKey:submitted.fileKey}},create:{resumeId:application.resumeId,fileKey:submitted.fileKey,parseStatus:'PENDING'},update:{}});
      await db.application.updateMany({where:{id:application.id,resumeVersionId:null},data:{resumeVersionId:version.id}});
    }
  }
  if(!version&&!application.resumeId){const submitted=submittedResume(snapshot);if(submitted.fileKey){const id='cvapp_'+createHash('sha256').update(application.id+':'+submitted.fileKey).digest('hex');version=await db.resumeVersion.upsert({where:{id},create:{id,fileKey:submitted.fileKey,parseStatus:'PENDING'},update:{}});await db.application.updateMany({where:{id:application.id,resumeVersionId:null},data:{resumeVersionId:version.id}});}}
  let facts=snapshot.cvEvidence;
  if(!facts && version?.parseStatus==='READY' && version.matchingData){
    facts=version.matchingData;
    // A compare-and-set prevents another reader or reparse from replacing the first evidence snapshot.
    const committed=await db.application.updateMany({where:{id:application.id,resumeSnapshot:{equals:application.resumeSnapshot===null?Prisma.DbNull:snapshot as Prisma.InputJsonValue}},data:{resumeSnapshot:JSON.parse(JSON.stringify({...snapshot,cvEvidence:facts}))}});
    if(!committed.count){const winner=await db.application.findUniqueOrThrow({where:{id:application.id},select:{resumeSnapshot:true}});facts=(winner.resumeSnapshot as {cvEvidence?:unknown}|null)?.cvEvidence??facts;}
  }
  return withCvFacts(profile,facts?{id:version?.id??'submitted',parseStatus:'READY',matchingData:facts}:version);
}
