const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const{createRequire}=require('node:module');
const api=createRequire(path.resolve('apps/api/package.json')),dotenv=createRequire(api.resolve('@nestjs/config'))('dotenv'),env=dotenv.parse(fs.readFileSync('.env'));
const url=new URL(env.DATABASE_URL);if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/job_talentio')throw Error('Local environment only');
const jwt=createRequire(api.resolve('@nestjs/jwt'))('jsonwebtoken'),{PrismaClient}=api('@prisma/client'),db=new PrismaClient({datasources:{db:{url:url.toString()}}});
(async()=>{try{
 const health=await fetch('http://localhost:4000/api/health');assert.equal(health.status,200);
 const suggestions=await fetch('http://localhost:4000/api/meta/employee-positions?q=cheff&limit=24').then(r=>r.json());assert.ok(suggestions.total>0,'running API must offer typo suggestions');
 const user=await db.user.findFirst({where:{role:'EMPLOYEE',isBanned:false,employeeProfile:{isNot:null}},select:{id:true,tokenVersion:true}});if(!user)throw Error('Local employee required');
 const token=jwt.sign({sub:user.id,tv:user.tokenVersion},env.JWT_SECRET?.trim()||'local-dev-jwt-secret',{expiresIn:'5m'});
 const response=await fetch('http://localhost:4000/api/jobs/recommended?page=1&limit=24',{headers:{Authorization:'Bearer '+token}});
 assert.equal(response.status,200,'local recommendation API');const body=await response.json();assert.equal(typeof body.evidenceState,'string','running API must expose independent CV state');
 for(const row of body.items){assert.ok(['EXACT','RELATED'].includes(row.matchType));if(body.mode==='PREFERENCES_BASED')assert.equal(row.matchScore,null);}
 const pages={};for(const [name,page]of [['web','http://localhost:3000/id/jobs'],['admin','http://localhost:3001']]){const res=await fetch(page);pages[name]=res.status;assert.ok(res.status<400);}
 const report={health:health.status,typoSuggestions:suggestions.total,recommendationStatus:response.status,state:body.state,mode:body.mode,evidenceState:body.evidenceState,returned:body.items.length,pages};
 fs.writeFileSync('output/recommendation-v32/http-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await db.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1});
