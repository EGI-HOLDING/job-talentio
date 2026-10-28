// Explicit local demo lifecycle. Never runs the application's general seed.
const fs=require('node:fs');
const path=require('node:path');
const {spawn,spawnSync,execFileSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {repo,req,directory,databaseName,config,assertDemoUrl}=require('./lib/hr-demo-env.cjs');
const action=process.argv[2]||'status';
const processFile=path.join(directory,'processes.json');
function run(exe,args,env,options={}) {
  const r=spawnSync(exe,args,{cwd:repo,env,stdio:'inherit',windowsHide:true,...options});
  if(r.status!==0)throw Error('Command failed: '+path.basename(exe)+' '+args[0]);
}
function sql(user,query){return execFileSync('docker',['exec','jt-postgres','psql','-U',user,'-d','postgres','-tAc',query,'-v','ON_ERROR_STOP=1'],{encoding:'utf8',windowsHide:true}).trim();}
async function health(){for(const [name,url]of [['api','http://localhost:4000/api/health'],['web','http://localhost:3000/en/login'],['admin','http://localhost:3001']]){const r=await fetch(url,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error(name+' not ready: '+r.status);}}
function redisReservation(env){
  const file=path.join(directory,'redis-owner.json');
  if(!fs.existsSync(file))throw Error('Prepare the isolated demo before starting or restoring');
  const reservation=JSON.parse(fs.readFileSync(file));
  if(reservation.database!==databaseName||reservation.url!==env.REDIS_URL||new URL(env.REDIS_URL).pathname!=='/14')throw Error('Demo Redis reservation changed');
}
async function identifyRuntime(){
  const c=config(),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
  const result=await fetch('http://localhost:4000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:c.credentials.accounts.hr,password:c.credentials.password,expectedRole:'RECRUITER'}),signal:AbortSignal.timeout(5000)});
  if(!result.ok)throw Error('API is reachable but demo HR login failed');
  const session=await result.json(),companies=await fetch('http://localhost:4000/api/companies/mine',{headers:{Authorization:'Bearer '+session.accessToken},signal:AbortSignal.timeout(5000)}).then(r=>r.json());
  if(!Array.isArray(companies)||companies.length!==3||companies.some(c=>!manifest.companies.some(m=>m.id===c.company.id)))throw Error('Ports are not serving the expected demo database');
  console.log('Demo ready: web http://localhost:3000 | API http://localhost:4000 | Admin http://localhost:3001');
}
function stop(){
  // Revalidate live ownership, including pre-existing Talentio runtime, before
  // taking the three ports explicitly requested by the owner for this demo.
  const script=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $repoPath='${repo.replaceAll("'","''")}'; $listeners=Get-NetTCPConnection -State Listen -LocalPort 3000,3001,4000 -ErrorAction SilentlyContinue; foreach($item in $listeners){$proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$item.OwningProcess); if(!$proc.CommandLine -or !$proc.CommandLine.Contains($repoPath)){throw ('Port '+$item.LocalPort+' is owned by another app')}}; foreach($ownerId in ($listeners.OwningProcess | Sort-Object -Unique)){Stop-Process -Id $ownerId -Force -ErrorAction Stop; Write-Output ('Stopped Talentio pid '+$ownerId)}`;
  run('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]);
  if(fs.existsSync(processFile))fs.unlinkSync(processFile);
}
async function start(env){
  redisReservation(env);
  if(!fs.existsSync(path.join(directory,'manifest.json')))throw Error('Prepare the demo before starting');
  stop();
  const records=[];
  for(const[name,port,args,cwd]of [
    ['api',4000,[path.join(repo,'apps/api/dist/main.js')],path.join(repo,'apps/api')],
    ...['web','admin'].map((name,i)=>[name,3000+i,[createRequire(path.join(repo,'apps',name,'package.json')).resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(3000+i)],path.join(repo,'apps',name)]),
  ]){
    const out=fs.openSync(path.join(directory,name+'.log'),'a');
    const child=spawn(process.execPath,args,{cwd,env:{...env,NODE_ENV:name==='api'?'development':'production'},detached:true,windowsHide:true,stdio:['ignore',out,out]});child.unref();fs.closeSync(out);records.push({name,pid:child.pid,port,database:databaseName});
  }
  fs.writeFileSync(processFile,JSON.stringify(records,null,2));
  for(let n=0;n<60;n++){try{await health();await identifyRuntime();return;}catch(e){if(n===59)throw e;await new Promise(r=>setTimeout(r,500));}}
}
function snapshot(user){
  const fd=fs.openSync(path.join(directory,'baseline.dump'),'w');
  try{const r=spawnSync('docker',['exec','jt-postgres','pg_dump','-U',user,'-d',databaseName,'-Fc'],{windowsHide:true,stdio:['ignore',fd,'inherit']});if(r.status!==0)throw Error('Snapshot failed');}finally{fs.closeSync(fd);}
}
async function backupObjects(env){
  const file=path.join(directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(file));
  const{S3Client,GetObjectCommand}=req('@aws-sdk/client-s3'),crypto=require('node:crypto');
  const s3=new S3Client({region:env.S3_REGION,endpoint:env.S3_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY,secretAccessKey:env.S3_SECRET_KEY}});
  try{for(const object of manifest.files){
    if(object.key.includes('..')||!/^(cvs|public)\/demo\//.test(object.key))throw Error('Unsafe demo object key');
    const result=await s3.send(new GetObjectCommand({Bucket:env.S3_BUCKET,Key:object.key}));const bytes=Buffer.from(await result.Body.transformToByteArray());
    const target=path.join(directory,'objects',object.key);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
    Object.assign(object,{bytes:bytes.length,type:result.ContentType,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }}finally{s3.destroy();}
  fs.writeFileSync(file,JSON.stringify(manifest,null,2));
}
function writeGuide(c){
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
  const hero=manifest.jobs[0];
  const lines=[
    '# Demo HR Talentio lokal','',
    'Dataset ini sintetis dan terpisah dari database kerja/staging. LinkedIn, Instagram, pembayaran, dan AI API tidak digunakan.','',
    '## Login','',
    '- HR: http://localhost:3000/id/login?role=RECRUITER',
    '- Admin: http://localhost:3001',
    '- Employee: http://localhost:3000/id/login?role=EMPLOYEE','',
    '| Akun | Email |','| --- | --- |',
    ...Object.entries(c.credentials.accounts).map(([role,email])=>'| '+role+' | '+email+' |'),'','Password demo semua akun: `'+c.credentials.password+'`','',
    'HR utama memiliki akses ke ketiga perusahaan. HR team hanya perusahaan utama; HR other hanya Meridian Retail untuk pemeriksaan batas akses. Gunakan profil browser berbeda untuk login employee/Admin bersamaan. Jangan simpan password di browser jika tidak diperlukan.','',
    '## Data awal','',
    ...manifest.companies.map(company=>'- '+company.name+' ('+company.package+'): '+manifest.jobs.filter(j=>j.companyId===company.id).length+' lowongan, '+manifest.jobs.filter(j=>j.companyId===company.id).reduce((n,j)=>n+j.count,0)+' lamaran.'),
    '- Total 160 profil kandidat sintetis dan 310 lamaran. Angka statistik berasal dari kejadian sintetis yang tersimpan di database.','',
    'Lowongan utama (80 pelamar): http://localhost:3000/id/dashboard/recruiter/jobs/'+hero.id+'?company='+hero.companyId,
    'Kanban: http://localhost:3000/id/dashboard/recruiter/jobs/'+hero.id+'?section=kanban&company='+hero.companyId,'',
    '## Perintah','',
    'Jalankan dari `C:\\IT\\egi-website\\job-talentio` dengan Docker Desktop aktif.','',
    '```powershell','node scripts/hr-demo.cjs start','node scripts/hr-demo.cjs status','node scripts/hr-demo.cjs verify','node scripts/hr-demo.cjs accounts','```','',
    'Kembalikan data setelah latihan/demo:','',
    '```powershell','node scripts/hr-demo.cjs restore','node scripts/hr-demo.cjs verify','```','',
    'Restore hanya database `talentio_hr_demo`, Redis DB14 yang dicadangkan untuk demo, indeks `talentio_hr_demo_jobs`, serta file dalam bucket `talentio-hr-demo`. Data kerja/staging dan pesan Mailpit lain tidak dihapus. Login ulang setelah restore jika sesi browser kedaluwarsa.','',
    'Baseline disiapkan pada '+manifest.preparedAt+'. Restore mempertahankan tanggal baseline; jika demo dilakukan lebih dari 10 hari setelah persiapan, buat dataset bertanggal baru:','',
    '```powershell','node scripts/hr-demo.cjs prepare --recreate','node scripts/hr-demo.cjs start','node scripts/hr-demo.cjs verify','```','',
    'Perintah recreate menghapus hanya isi database demo dan membuat ID baru. Kredensial tetap sama. Jalankan hanya saat tidak sedang presentasi. Setelah perubahan kode, jalankan `node scripts/hr-demo.cjs build` lalu `start`.','',
    'Uji tindakan HR yang akan mengubah data demo: `node scripts/hr-demo.cjs verify --exercise`, kemudian `restore`.','',
    'Email ditangkap Mailpit lokal http://localhost:8025. CV parsing menggunakan parser lokal. Tidak ada pengiriman Telegram/LinkedIn atau pembayaran.','',
    'Build demo berada di `.next-demo`; root `.env` tidak diubah. Log dan bukti pemeriksaan berada di `node_modules/.cache/hr-demo`. Kredensial lokal ini tidak dilacak Git.','',
  ];
  const file=path.join(directory,'DEMO-READY.md');fs.writeFileSync(file,lines.join('\n'));console.log('Guide: '+file);
}
async function main(){
  const c=config({realAuth:process.argv.includes('--real-auth')});assertDemoUrl(c.env.DATABASE_URL);
  if(action==='prepare'){
    if(!process.argv.includes('--recreate')&&fs.existsSync(path.join(directory,'baseline.dump'))&&fs.existsSync(path.join(directory,'manifest.json'))){console.log('Prepared baseline retained. Use restore to undo demo actions, or prepare --recreate for a new dataset.');return;}
    const Redis=req('ioredis');const redis=new Redis(c.env.REDIS_URL),reservation=path.join(directory,'redis-owner.json');
    try{if(!fs.existsSync(reservation)&&(await redis.dbsize())>0)throw Error('Selected Redis database is occupied; refusing to mix environments');
      if(fs.existsSync(reservation)&&JSON.parse(fs.readFileSync(reservation)).url!==c.env.REDIS_URL)throw Error('Redis reservation changed');
      fs.writeFileSync(reservation,JSON.stringify({database:databaseName,url:c.env.REDIS_URL}));
    }finally{redis.disconnect();}
    if(process.argv.includes('--recreate')&&sql(c.pgUser,`SELECT 1 FROM pg_database WHERE datname='${databaseName}'`)){
      if(fs.existsSync(processFile))stop();sql(c.pgUser,`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      const manifest=path.join(directory,'manifest.json');if(fs.existsSync(manifest))fs.unlinkSync(manifest);
    }
    if(!sql(c.pgUser,`SELECT 1 FROM pg_database WHERE datname='${databaseName}'`))sql(c.pgUser,`CREATE DATABASE "${databaseName}"`);
    run(process.execPath,[req.resolve('prisma/build/index.js'),'migrate','deploy','--schema',path.join(repo,'apps/api/prisma/schema.prisma')],c.env);
    run('cmd.exe',['/d','/c','corepack','pnpm','--filter','@job-talentio/api','build'],c.env);
    run(process.execPath,[path.join(repo,'apps/api/dist/scripts/hr-demo.js')],c.env);
    await backupObjects(c.env);snapshot(c.pgUser);writeGuide(c);console.log('Demo prepared; database and object baseline saved.');
  }else if(action==='build'){
    for(const [app,task]of [['shared','build'],['api','build'],['web','build'],['admin','build']])run('cmd.exe',['/d','/c','corepack','pnpm','--filter','@job-talentio/'+app,task],{...c.env,NODE_ENV:'production'});
  }else if(action==='start')await start(c.env);
  else if(action==='stop')stop();
  else if(action==='restore'){
    redisReservation(c.env);
    const manifestFile=path.join(directory,'manifest.json'),dump=path.join(directory,'baseline.dump');
    if(!fs.existsSync(dump)||!fs.existsSync(manifestFile))throw Error('Prepare the demo before restoring');
    const manifest=JSON.parse(fs.readFileSync(manifestFile));if(manifest.database!==databaseName)throw Error('Invalid demo manifest');
    if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Missing demo object manifest');
    const crypto=require('node:crypto');
    for(const file of manifest.files){if(file.key.includes('..')||!/^(cvs|public)\/demo\//.test(file.key))throw Error('Unsafe object path');const bytes=fs.readFileSync(path.join(directory,'objects',file.key));if(crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Demo object backup changed');}
    stop();sql(c.pgUser,`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${databaseName}' AND pid<>pg_backend_pid()`);
    const fd=fs.openSync(dump,'r');try{const r=spawnSync('docker',['exec','-i','jt-postgres','pg_restore','-U',c.pgUser,'-d',databaseName,'--clean','--if-exists','--exit-on-error'],{stdio:[fd,'inherit','inherit'],windowsHide:true});if(r.status!==0)throw Error('Restore failed');}finally{fs.closeSync(fd);}
    const Redis=req('ioredis'),redis=new Redis(c.env.REDIS_URL);try{await redis.flushdb();}finally{redis.disconnect();}
    const{S3Client,PutObjectCommand}=req('@aws-sdk/client-s3'),s3=new S3Client({region:c.env.S3_REGION,endpoint:c.env.S3_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:c.env.S3_ACCESS_KEY,secretAccessKey:c.env.S3_SECRET_KEY}});
    try{for(const file of manifest.files)await s3.send(new PutObjectCommand({Bucket:c.env.S3_BUCKET,Key:file.key,Body:fs.readFileSync(path.join(directory,'objects',file.key)),ContentType:file.type}));}finally{s3.destroy();}
    await fetch(c.env.MEILI_HOST+'/indexes/'+c.env.MEILI_JOBS_INDEX,{method:'DELETE',headers:{Authorization:'Bearer '+c.env.MEILI_MASTER_KEY}});
    await start(c.env);console.log('Baseline restored. Dates remain anchored to preparation time.');
  }else if(action==='backup-objects')await backupObjects(c.env);
  else if(action==='guide')writeGuide(c);
  else if(action==='verify')run(process.execPath,[path.join(repo,'scripts/hr-demo-verify.cjs'),...process.argv.slice(3)],c.env);
  else if(action==='status'){await health();await identifyRuntime();}
  else if(action==='accounts')console.log(JSON.stringify({accounts:c.credentials.accounts,password:c.credentials.password,login:'http://localhost:3000/id/login?role=RECRUITER',admin:'http://localhost:3001'},null,2));
  else throw Error('Use prepare | build | start | stop | verify | restore | status | accounts');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
