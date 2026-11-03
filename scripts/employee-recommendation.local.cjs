const fs=require('node:fs');const path=require('node:path');const{createRequire}=require('node:module');const{spawnSync}=require('node:child_process');
const api=createRequire(path.resolve('apps/api/package.json'));const dotenv=createRequire(api.resolve('@nestjs/config'))('dotenv');
const env=dotenv.parse(fs.readFileSync('.env'));const url=new URL(env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/job_talentio')throw Error('Verified local development database required');
const args=process.argv.slice(2),check=args[0]==='--check';if(check)args.shift();
const result=spawnSync(process.execPath,[api.resolve('tsx/cli'),'--tsconfig','apps/api/tsconfig.json',check?'apps/api/src/scripts/employee-recommendation-local-check.ts':'apps/api/src/scripts/employee-recommendation-local.ts',...args],{stdio:'inherit',windowsHide:true,env:{...process.env,...env}});process.exitCode=result.status??1;
