import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { historicalHrSubmission } from '../matching/recruiter-evidence';
import { loadHrCatalog } from '../matching/recruiter-ranking.service';
import { HR_PARSER } from '../matching/recruiter-ranking';
async function main(){
  const url=new URL(process.env.DATABASE_URL!);
  if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||!/^\/talentio_(?:mapping_local_20261103|hr_v2_it_\d+)$/.test(url.pathname))throw Error('HR backfill is local-only');
  const apply=process.argv.includes('--apply'),db=new PrismaService();
  try{
    const [rows,catalog]=await Promise.all([db.application.findMany({where:{profile:{user:{anonymizedAt:null}}},include:{resumeVersion:true},orderBy:{id:'asc'}}),loadHrCatalog(db)]);
    const missing=rows.filter(r=>!r.hrSubmissionSnapshot);
    const report={mode:apply?'apply':'dry-run',database:url.pathname,applications:rows.length,snapshotsToFreeze:missing.length,unboundSubmittedFiles:rows.filter(r=>!r.resumeVersionId&&historicalHrSubmission(r).fileKey).map(r=>r.id),missingFiles:rows.filter(r=>!historicalHrSubmission(r).fileKey).map(r=>r.id),catalogRevision:catalog.revision,changesToCatalog:0};
    if(apply){for(const row of missing)await db.application.updateMany({where:{id:row.id,hrSubmissionSnapshot:{equals:Prisma.DbNull}},data:{hrSubmissionSnapshot:JSON.parse(JSON.stringify(historicalHrSubmission(row)))}});
      const versions=await db.resumeVersion.findMany({where:{OR:[{applications:{some:{profile:{user:{anonymizedAt:null}}}}},{currentFor:{is:{deletedAt:null,profile:{databaseCvEnabled:true}}}}]},select:{id:true,parseGeneration:true}});
      await db.resumeRecruiterEvidence.createMany({data:versions.map(v=>({versionId:v.id,generation:v.parseGeneration,parserVersion:HR_PARSER,catalogRevision:catalog.revision})),skipDuplicates:true});
    }
    fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/hr-ranking-backfill-'+(apply?'applied':'dry-run')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,missingFiles:report.missingFiles.length,unboundSubmittedFiles:report.unboundSubmittedFiles.length}));
  }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
