// One reproducible acceptance round. Run twice after the final source change.
const fs=require('node:fs'),path=require('node:path'),{spawnSync,execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),name=process.argv[2];if(!/^round-[1-9]\d*$/.test(name||''))throw Error('Use round-N');
const out=path.join(root,'output/package-readiness-20261028',name);if(fs.existsSync(out))throw Error('Keep earlier evidence; choose a new round number');fs.mkdirSync(out,{recursive:true});
function fingerprint(){const files=execFileSync('git',['ls-files','-m','-o','--exclude-standard','--','apps','packages','scripts'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean).sort();const hash=createHash('sha256');for(const file of files){hash.update(file);hash.update(fs.existsSync(path.join(root,file))?fs.readFileSync(path.join(root,file)):'[deleted]');}return hash.digest('hex');}
const checks=[
  ['API source regressions','run-api-smoke.cjs'],
  ['Checkout network and navigation recovery','package-checkout-ui.smoke.cjs'],
  ['Pricing package intent and stale job navigation','package-selection-ui.smoke.cjs'],
  ['Pricing translations and feature disclosure','job-commerce-ui.smoke.cjs'],
  ['HR access and stale-response UI','hr-access-ui.smoke.cjs'],
  ['LinkedIn component logic','linkedin-ui.smoke.cjs'],
  ['Account navigation','account-navigation.smoke.cjs'],
  ['Commerce database and injected faults','hr-benefits-local.smoke.cjs','--commerce'],
  ['Benefits applicants analytics search database','hr-benefits-local.smoke.cjs'],
  ['LinkedIn isolated DB storage Redis','hr-benefits-local.smoke.cjs','--linkedin'],
  ['Pricing onboarding checkout publication upgrades browser','job-commerce-browser.smoke.cjs'],
  ['Auth language refresh logout browser','job-commerce-auth-browser.smoke.cjs'],
  ['Permissions renewal orders admin browser','job-commerce-edge-browser.smoke.cjs'],
  ['Features statistics reports support real UI browser','package-features-browser.smoke.cjs'],
  ['LinkedIn multilingual responsive accessibility browser','linkedin-browser-audit.cjs'],
];
const report={name,startedAt:new Date().toISOString(),sourceHash:fingerprint(),checks:[],passed:false};
function save(){fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}save();
for(const [title,script,...args] of checks){
  const start=Date.now();console.log('RUN '+title);
  const result=spawnSync(process.execPath,[path.join(root,'scripts',script),...args],{cwd:root,windowsHide:true,encoding:'utf8',timeout:360000,maxBuffer:10*1024*1024});
  const log=String(result.stdout||'')+String(result.stderr||'')+(result.error?'\n'+result.error.message:'');
  fs.writeFileSync(path.join(out,script.replace(/\.cjs$/,'')+(args[0]||'')+'.log'),log);
  const check={title,command:['node','scripts/'+script,...args],exitCode:result.status,durationMs:Date.now()-start,passed:result.status===0};report.checks.push(check);save();
  console.log((check.passed?'PASS ':'FAIL ')+title+' ('+check.durationMs+'ms)');
  if(!check.passed){console.error(log.slice(-7000));process.exitCode=1;break;}
}
report.finishedAt=new Date().toISOString();report.endSourceHash=fingerprint();report.passed=report.checks.length===checks.length&&report.checks.every(x=>x.passed)&&report.sourceHash===report.endSourceHash;save();if(!report.passed)process.exitCode=1;
