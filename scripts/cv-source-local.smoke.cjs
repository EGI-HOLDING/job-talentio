// Creates and drops only its own disposable local database. Never loads application data.
const {execFileSync,spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');const path=require('node:path');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
const info=JSON.parse(execFileSync('docker',['inspect','jt-postgres'],{encoding:'utf8',windowsHide:true}))[0];
const settings=Object.fromEntries(info.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
const name='talentio_cv_it_'+Date.now();if(!/^talentio_cv_it_\d+$/.test(name))throw Error('Unsafe fixture database');
const user=settings.POSTGRES_USER||'postgres',port=info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
const env={...process.env,NODE_ENV:'test',DATABASE_URL:`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(settings.POSTGRES_PASSWORD)}@127.0.0.1:${port}/${name}`,CV_SOURCE_TEST_DATABASE:name};
const minio=JSON.parse(execFileSync('docker',['inspect','egi-minio'],{encoding:'utf8',windowsHide:true}))[0];
const minioEnv=Object.fromEntries(minio.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
Object.assign(env,{CV_TEST_STORAGE_ENDPOINT:'http://127.0.0.1:'+minio.NetworkSettings.Ports['9000/tcp'][0].HostPort,CV_TEST_STORAGE_USER:minioEnv.MINIO_ROOT_USER,CV_TEST_STORAGE_PASSWORD:minioEnv.MINIO_ROOT_PASSWORD});
function run(file,args){const r=spawnSync(process.execPath,[file,...args],{cwd:path.join(root,'apps/api'),env,stdio:'inherit',windowsHide:true});if(r.status!==0)throw Error('Fixture check failed ('+r.status+')');}
try{execFileSync('docker',['exec','jt-postgres','createdb','-U',user,name],{windowsHide:true});run(req.resolve('prisma/build/index.js'),['migrate','deploy']);run(req.resolve('tsx/cli'),['src/profiles/cv-source.integration.smoke.ts']);}
finally{execFileSync('docker',['exec','jt-postgres','dropdb','-U',user,'--force','--if-exists',name],{windowsHide:true});}
