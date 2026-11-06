const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const api=path.resolve('apps/api');
const script=JSON.parse(fs.readFileSync(path.join(api,'package.json'),'utf8')).scripts.test;
const runtime=path.dirname(process.execPath);
const result=spawnSync(script,{cwd:api,shell:true,windowsHide:true,stdio:'inherit',env:{...process.env,EMPLOYEE_EXPERIENCE_POLICY_ENABLED:'false',PATH:[runtime,path.join(api,'node_modules','.bin'),process.env.PATH].join(path.delimiter)}});
if(result.error)throw result.error;process.exitCode=result.status??1;
