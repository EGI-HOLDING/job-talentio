const fs=require('node:fs');const path=require('node:path');const net=require('node:net');const{spawn}=require('node:child_process');const{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),api=createRequire(path.join(root,'apps/api/package.json')),dotenv=createRequire(api.resolve('@nestjs/config'))('dotenv');
const env=dotenv.parse(fs.readFileSync(path.join(root,'.env'),'utf8')),url=new URL(env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/job_talentio')throw Error('Verified local database required');
const out=path.join(root,'output/recommendation-v32');fs.mkdirSync(out,{recursive:true});
const occupied=port=>new Promise(resolve=>{const socket=net.connect({port,host:'127.0.0.1'});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});
(async()=>{const records=[];
 for(const [name,port,cwd,args]of [['api',4000,'apps/api',[path.join(root,'apps/api/dist/main.js')]],['web',3000,'apps/web',[createRequire(path.join(root,'apps/web/package.json')).resolve('next/dist/bin/next'),'dev','-p','3000']]]){
  if(await occupied(port)){console.log(name+': already listening; no process replaced');continue;}
  const stdout=fs.openSync(path.join(out,name+'.log'),'a'),stderr=fs.openSync(path.join(out,name+'.error.log'),'a');
  const child=spawn(process.execPath,args,{cwd:path.join(root,cwd),env:{...process.env,...env,NODE_ENV:'development'},detached:true,windowsHide:true,stdio:['ignore',stdout,stderr]});child.unref();fs.closeSync(stdout);fs.closeSync(stderr);records.push({name,pid:child.pid,port});console.log(name+': started on localhost:'+port);
 }fs.writeFileSync(path.join(out,'processes.json'),JSON.stringify(records,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
