const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');const api=path.join(root,'apps/api');const req=createRequire(path.join(api,'package.json'));const dotenv=createRequire(req.resolve('@nestjs/config'))('dotenv');
const env=dotenv.parse(fs.readFileSync(path.join(root,'.env'),'utf8'));const url=new URL(env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434')throw Error('Integration runs only against local PostgreSQL on port 5434');
const name='talentio_employee_intent_v3_it_'+Date.now();if(!/^talentio_employee_intent_v3_it_\d+$/.test(name))throw Error('Invalid isolated database');url.pathname='/'+name;
const docker=(sql)=>cp.execFileSync('docker',['exec','jt-postgres','sh','-c',sql],{stdio:'pipe'});
let created=false;
try{
 docker('createdb -U "$POSTGRES_USER" '+name);created=true;
 const childEnv={...process.env,DATABASE_URL:url.toString(),TEST_DATABASE_URL:url.toString(),EMPLOYEE_INTENT_V3_MODE:'shadow'};
 cp.execFileSync(process.execPath,[req.resolve('prisma/build/index.js'),'migrate','deploy','--schema',path.join(api,'prisma/schema.prisma')],{cwd:root,env:childEnv,stdio:'inherit'});
 cp.execFileSync(process.execPath,['-r',req.resolve('tsx/cjs'),path.join(api,'src/matching/employee-intent.integration.smoke.ts')],{cwd:api,env:childEnv,stdio:'inherit'});
}finally{if(created){docker('dropdb -U "$POSTGRES_USER" '+name);console.log('Dropped isolated integration database '+name);}}
