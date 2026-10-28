// Additive migrations and API restart for the explicitly isolated local demo.
const fs=require('node:fs'),path=require('node:path'),{execFileSync,spawn}=require('node:child_process');
const h=require('./lib/hr-demo-env.cjs'),c=h.config({realAuth:true});h.assertDemoUrl(c.databaseUrl);
const file=path.join(h.directory,'processes.json'),state=JSON.parse(fs.readFileSync(file));
const record=state.find(item=>item.name==='api');if(!record)throw Error('Missing API record');
const script=`$taskListener=Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue; foreach($taskOwner in ($taskListener.OwningProcess | Sort-Object -Unique)) { $taskApi = Get-CimInstance Win32_Process -Filter ('ProcessId='+$taskOwner); if ($taskApi.CommandLine -notlike '*job-talentio*apps*api*dist*main.js*') { throw 'Refusing an unrelated process' }; Stop-Process -Id $taskOwner }`;
execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:'inherit',windowsHide:true});
function run(args,cwd=h.repo){execFileSync(process.execPath,args,{cwd,env:c.env,stdio:'inherit',windowsHide:true});}
try {
  if(!process.argv.includes('--no-schema')) {
    run([h.req.resolve('prisma/build/index.js'),'generate','--schema','apps/api/prisma/schema.prisma']);
    run([h.req.resolve('prisma/build/index.js'),'migrate','deploy','--schema','apps/api/prisma/schema.prisma']);
  }
  run(['node_modules/@nestjs/cli/bin/nest.js','build'],path.join(h.repo,'apps/api'));
} finally {
  const log=fs.openSync(path.join(h.directory,'api.log'),'a');
  const api=spawn(process.execPath,[path.join(h.repo,'apps/api/dist/main.js')],{cwd:h.repo,env:c.env,detached:true,windowsHide:true,stdio:['ignore',log,log]});api.unref();
  const latest=JSON.parse(fs.readFileSync(file));latest.find(item=>item.name==='api').pid=api.pid;fs.writeFileSync(file,JSON.stringify(latest,null,2));console.log('Local API started',api.pid);
}
