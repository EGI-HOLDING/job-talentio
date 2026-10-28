// Run the repository's API smoke command without shell quoting or a package-manager download.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),cwd=path.join(root,'apps/api'),req=createRequire(path.join(cwd,'package.json'));
const commands=JSON.parse(fs.readFileSync(path.join(cwd,'package.json'))).scripts.test.split(' && '),checks=[];
for(const command of commands){
  let args,label,generated;
  if(command.startsWith('tsx -e "')&&command.endsWith('"')){generated=path.join(cwd,'.api-smoke-inline.ts');fs.writeFileSync(generated,command.slice(8,-1));args=[generated];label='inline title normalization';}
  else if(/^tsx [a-zA-Z0-9_./-]+\.ts$/.test(command)){args=[command.slice(4)];label=command.slice(4);}
  else throw Error('Unexpected smoke command');
  const result=spawnSync(process.execPath,[req.resolve('tsx/cli'),'--tsconfig','tsconfig.json',...args],{cwd,env:{...process.env,NODE_ENV:'test',CV_PARSE_PROVIDER:'local'},encoding:'utf8',windowsHide:true,maxBuffer:5*1024*1024});
  if(generated)fs.unlinkSync(generated);
  checks.push({test:label,passed:result.status===0});process.stdout.write((result.stdout||'')+(result.stderr||''));
  if(result.status!==0){const out=path.join(root,'output/job-commerce');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'api-smoke.json'),JSON.stringify(checks,null,2));process.exit(result.status||1);}
}
const out=path.join(root,'output/job-commerce');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'api-smoke.json'),JSON.stringify(checks,null,2));console.log('PASS all API smoke checks:',checks.length);
