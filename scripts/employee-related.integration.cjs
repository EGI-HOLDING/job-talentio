const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),api=createRequire(path.join(root,'apps/api/package.json')),dotenv=createRequire(api.resolve('@nestjs/config'))('dotenv');
const env=dotenv.parse(fs.readFileSync(path.join(root,'.env'),'utf8')),url=new URL(env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/job_talentio')throw Error('Verified local source required');
const name='talentio_recommendation_v32_it_'+Date.now(),dump='/tmp/'+name+'.dump';url.pathname='/'+name;
const docker=(args)=>cp.execFileSync('docker',args,{stdio:'pipe'});
let created=false;
try{
 docker(['exec','jt-postgres','pg_dump','-U','talentio','-d','job_talentio','-Fc','-f',dump]);
 docker(['exec','jt-postgres','createdb','-U','talentio',name]);created=true;
 docker(['exec','jt-postgres','pg_restore','-U','talentio','--no-owner','--exit-on-error','-d',name,dump]);
 cp.execFileSync(process.execPath,[api.resolve('tsx/cli'),'--tsconfig','apps/api/tsconfig.json','apps/api/src/matching/employee-related.integration.ts'],{cwd:root,env:{...process.env,...env,DATABASE_URL:url.toString(),NODE_ENV:'development'},stdio:'inherit',windowsHide:true});
}finally{if(created)docker(['exec','jt-postgres','dropdb','-U','talentio','--force',name]);docker(['exec','jt-postgres','rm','-f',dump]);}
