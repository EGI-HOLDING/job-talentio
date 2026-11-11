// Read-only measurement against a disposable local copy, using the selected API build.
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const api=path.resolve(__dirname,'../apps/api');
const from=part=>require(path.join(api,part));
from('node_modules/reflect-metadata');
const {PrismaClient}=from('node_modules/@prisma/client');
const {ConfigService}=from('node_modules/@nestjs/config');
const {CandidateCache}=from('dist/common/candidate-cache');
const {OccupationRelationsService}=from('dist/matching/occupation-relations.service');
const {EmployeeCatalogSnapshot}=from('dist/matching/employee-catalog-snapshot');
const {VacancyTasksService}=from('dist/matching/vacancy-tasks.service');
const {PositionGroupService}=from('dist/matching/position-group.service');
const {EmployeeIntentService}=from('dist/matching/employee-intent.service');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||!/^\/talentio_selection_it_\d+$/.test(url.pathname))throw Error('Disposable local selection database required');
const db=new PrismaClient(),cache=new CandidateCache(new ConfigService(process.env));
const relations=new OccupationRelationsService(db,cache),catalog=new EmployeeCatalogSnapshot(db,cache,relations);
const service=new EmployeeIntentService(db,catalog,cache,new VacancyTasksService(db,relations,cache),new PositionGroupService(db,relations,cache));
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
async function main(){
 const file=process.argv[2];if(!file)throw Error('Output report path required');
 const candidates=await db.employeeProfile.findMany({where:{matchingPreferencesReviewed:true,desiredRoles:{some:{}}},select:{id:true,desiredRoles:{select:{jobTitle:{select:{familyId:true}}}}},orderBy:{id:'asc'}});
 const profiles=[],families=new Set();
 for(const row of candidates){const key=row.desiredRoles.map(x=>x.jobTitle.familyId).sort().join('|');if(!families.has(key)){families.add(key);profiles.push(row.id);}if(profiles.length===20)break;}
 if(!profiles.length)throw Error('No eligible profile in local baseline copy');
 const graph=await catalog.get(true),cold=[],warm=[],results=[];
 const timed=async(id)=>{const start=performance.now();const out=await service.recommend(id,1,24,undefined,'recommendations',{separated:false});return {out,ms:performance.now()-start};};
 for(const id of profiles){const a=await timed(id),b=await timed(id);cold.push(a.ms);warm.push(b.ms);results.push({id,state:a.out.state,reason:a.out.emptyReason,engine:a.out.version,selectionRevision:a.out.selectionRevision,total:a.out.total,primary:a.out.primaryTotal,related:a.out.relatedTotal,totalPages:a.out.totalPages,items:a.out.items.map(row=>({id:row.job.id,basis:row.selectionBasis,score:row.matchScore}))});}
 const refs={};
 for(const [table,columns] of Object.entries({JobTitle:['id','familyId','canonicalRoleId','archivedAt'],JobFamily:['id','archivedAt'],EmployeeDesiredRole:['profileId','jobTitleId'],EmployeeDesiredGroup:['profileId','groupId'],ResumeVersion:['id','parseGeneration'],Application:['id','profileId','jobPostId'],ApplicationRecruiterEvaluation:['id','applicationId']})){
  const fields=columns.map(column=>'"'+column+'"').join(',');
  const [row]=await db.$queryRawUnsafe('SELECT count(*)::int AS count, md5(COALESCE(string_agg(record::text,\'\' ORDER BY record::text),\'\')) AS checksum FROM (SELECT '+fields+' FROM "'+table+'") record');refs[table]=row;
 }
 const report={graph:graph.relationReleaseId,selectionRevision:graph.selectionRevision,positions:graph.roles.length,profiles:profiles.length,latency:{coldP95:p95(cold),warmP95:p95(warm),cold,warm},refs,results};
 fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,results:undefined}));
}
void main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(async()=>{cache.onModuleDestroy();await db.$disconnect();});
