// Disposable local PostgreSQL only. No application database or production credentials are loaded.
const {execFileSync,spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');const path=require('node:path');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
const info=JSON.parse(execFileSync('docker',['inspect','jt-postgres'],{encoding:'utf8',windowsHide:true}))[0];
const settings=Object.fromEntries(info.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
const name='talentio_hr_v2_it_'+Date.now(),user=settings.POSTGRES_USER||'postgres',port=info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
if(!/^talentio_hr_v2_it_\d+$/.test(name)||port!=='5434')throw Error('Disposable local DB guard failed');
const env={...process.env,NODE_ENV:'test',DATABASE_URL:`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(settings.POSTGRES_PASSWORD)}@127.0.0.1:${port}/${name}`,HR_RANKING_V2_MODE:'enabled',EMPLOYEE_INTENT_V3_MODE:'off',TELEGRAM_BOT_TOKEN:'',RESEND_API_KEY:'',HR_V2_TEST_DATABASE:name};
function run(file,args){const r=spawnSync(process.execPath,[file,...args],{cwd:root,env,stdio:'inherit',windowsHide:true});if(r.status!==0)throw Error('HR v2 check failed ('+r.status+')');}
try{execFileSync('docker',['exec','jt-postgres','createdb','-U',user,name],{windowsHide:true});run(req.resolve('prisma/build/index.js'),['migrate','deploy','--schema','apps/api/prisma/schema.prisma']);run(req.resolve('tsx/cli'),['--tsconfig','apps/api/tsconfig.json','apps/api/src/matching/recruiter-ranking.integration.smoke.ts',...process.argv.slice(2)]);}
finally{execFileSync('docker',['exec','jt-postgres','dropdb','-U',user,'--force','--if-exists',name],{windowsHide:true});}
