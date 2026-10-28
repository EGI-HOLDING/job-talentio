// Read-only HTTP verification. Tokens are short-lived, in memory, never printed or saved.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {createRequire}=require('node:module');
const req=createRequire(path.resolve(__dirname,'../apps/api/package.json'));
const dotenv=createRequire(req.resolve('@nestjs/config'))('dotenv');const {PrismaClient}=req('@prisma/client');const {JwtService}=req('@nestjs/jwt');
async function main(){
  const config=dotenv.parse(fs.readFileSync(path.resolve(__dirname,'../.env'),'utf8'));
  const url=new URL(config.DATABASE_URL);if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/job_talentio')throw Error('Approved local runtime only');
  const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
  try{
    const employee=await db.user.findFirst({where:{role:'EMPLOYEE',isBanned:false,employeeProfile:{skills:{some:{}}}},select:{id:true,tokenVersion:true,employeeProfile:{select:{id:true}}}});
    const recruiter=await db.user.findFirst({where:{role:'RECRUITER',isBanned:false},select:{id:true,tokenVersion:true}});
    assert.ok(employee&&recruiter,'local test identities unavailable');
    const jwt=new JwtService({secret:config.JWT_SECRET});
    const token=user=>jwt.sign({sub:user.id,tv:user.tokenVersion},{expiresIn:'90s'});
    const employeeToken=token(employee);const recruiterToken=token(recruiter);
    const request=async(endpoint,auth=employeeToken,locale='id')=>{
      const start=performance.now();const response=await fetch('http://127.0.0.1:4000/api'+endpoint,{headers:{...(auth?{Authorization:'Bearer '+auth}:{}),'Accept-Language':locale,Origin:'http://localhost:3000'}});
      const text=await response.text();return {status:response.status,data:JSON.parse(text),bytes:Buffer.byteLength(text),ms:Math.round(performance.now()-start)};
    };
    assert.equal((await request('/jobs/recommended',null)).status,401);
    assert.equal((await request('/jobs/recommended',recruiterToken)).status,403);
    assert.equal((await request('/jobs/recommended?page=1&limit=51')).status,400);
    const page=await request('/jobs/recommended?page=1&limit=6');assert.equal(page.status,200);assert.ok(page.data.items.length<=6);
    assert.equal(page.data.version,'employee-evidence-v2');
    const translated=await request('/jobs/recommended?page=1&limit=6',employeeToken,'uz');assert.deepEqual(translated.data.items.map(row=>row.job.id),page.data.items.map(row=>row.job.id));
    if(page.data.totalPages>1){const next=await request('/jobs/recommended?page=2&limit=6');assert.ok(next.data.items.every(row=>!page.data.items.some(first=>first.job.id===row.job.id)));}
    const compatibility=await request('/jobs/recommended?limit=6');assert.ok(Array.isArray(compatibility.data));
    const jobId=page.data.items[0].job.id;
    const viewsBefore=await db.jobView.count({where:{jobPostId:jobId,viewerId:employee.id}});
    const insights=await request(`/jobs/${jobId}/match-insights`);assert.equal(insights.status,200);assert.equal(insights.data.matchInsights.version,'employee-evidence-v2');
    assert.equal(await db.jobView.count({where:{jobPostId:jobId,viewerId:employee.id}}),viewsBefore);
    const privateJob=await db.jobPost.findFirst({where:{status:'DRAFT',applications:{none:{profileId:employee.employeeProfile.id}}},select:{id:true}});
    if(privateJob)assert.equal((await request(`/jobs/${privateJob.id}/match-insights`)).status,404);
    const search=await request('/jobs?sort=match&limit=6');assert.equal(search.status,200);assert.ok(search.data.items.every(row=>row.matchInsights?.version==='employee-evidence-v2'));
    console.log(JSON.stringify({http:true,employeeOnly:true,pagination:true,localeParity:true,arrayCompatibility:true,privateJobsDenied:true,noJobViewSideEffect:true,
      recommendationBytes:page.bytes,recommendationMs:page.ms,returned:page.data.items.length}));
  }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
