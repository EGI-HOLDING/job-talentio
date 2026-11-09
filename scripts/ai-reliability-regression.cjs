// Deterministic regression gate. Real-provider and production/demo evidence remain separate.
const fs=require('node:fs'),path=require('node:path'),{spawnSync,execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),api=createRequire(path.join(root,'apps/api/package.json'));
const out=process.env.AI_RELIABILITY_OUTPUT||path.join(root,'output/ai-reliability');fs.mkdirSync(out,{recursive:true});
const args=new Set(process.argv.slice(2));if(!args.size)args.add('--unit');
for(const arg of args)if(!['--unit','--integration','--browser','--all'].includes(arg))throw Error('Unknown regression group: '+arg);
const selected=group=>args.has('--all')||args.has('--'+group),tests=[];
const tsx=api.resolve('tsx/cli');
if(selected('unit')){
 for(const file of ['screening-client.smoke.ts','screening-worker-dispatch.smoke.ts','screening.smoke.ts','conversation.smoke.ts','claim-assessment.smoke.ts','voice/voice-evidence.smoke.ts','recruitment/cv-scoring.smoke.ts'])tests.push({id:file,layer:'unit',args:[tsx,'--tsconfig','apps/api/tsconfig.json','apps/api/src/ai-screening/'+file]});
 tests.push({id:'job-content-ai.smoke.ts',layer:'unit',args:[tsx,'--tsconfig','apps/api/tsconfig.json','apps/api/src/job-content-ai/job-content-ai.smoke.ts']});
 tests.push({id:'hr-forms',layer:'component',args:['--test','scripts/hr-flow-onboarding-ui.smoke.cjs','scripts/recruiter-package-onboarding.smoke.cjs']});
}
if(selected('integration')){
 tests.push({id:'api-production-build',layer:'build',cwd:path.join(root,'apps/api'),args:['node_modules/@nestjs/cli/bin/nest.js','build']});
 for(const file of ['recruitment-local.cjs','tara-screening-local.cjs','recruitment-http.cjs'])tests.push({id:file,layer:'integration',args:['scripts/'+file]});
}
if(selected('browser'))for(const file of ['recruitment-onboarding.browser.cjs','candidate-apply.browser.cjs','screening-verification.browser.cjs','invited-voice-ui.browser.cjs','screening-workspace.browser.cjs','recruitment-ui.browser.cjs'])tests.push({id:file,layer:'browser-with-provider-fixtures',args:['scripts/'+file]});
if(selected('browser')&&selected('integration'))tests.push({id:'browser-nest-candidate-to-hr',layer:'browser-real-local-backend',args:['scripts/recruitment-http.cjs','--browser']});
if(selected('unit'))tests.unshift({id:'ascii-ui',layer:'repository-guard',args:['scripts/check-ascii-ui.mjs']},{id:'i18n-ui',layer:'repository-guard',args:['scripts/check-i18n-ui.mjs']});
const env={...process.env,OPENAI_API_KEY:'',TELEGRAM_BOT_TOKEN:'',RESEND_API_KEY:'',RECRUITMENT_WEB_URL:process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035',AI_RELIABILITY_OUTPUT:out};
if(selected('browser')&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(env.RECRUITMENT_WEB_URL))throw Error('Local-only browser regression guard');
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),worktree:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8',windowsHide:true}).trim().split('\n'),startedAt:new Date().toISOString(),groups:[...args],tests:[],paidProviderCalls:0,fullMissionPassed:false,limitations:['AI responses are simulated. Browser fixture tests and the browser journey with the real local backend are reported separately.','Passing this runner does not prove real voice/audio, provider latency under concurrent HR load, full production journeys, or rehearsal readiness.']};
const save=()=>fs.writeFileSync(path.join(out,'regression-gate.json'),JSON.stringify(report,null,2));
for(const test of tests){
 const started=Date.now(),result=spawnSync(process.execPath,test.args,{cwd:test.cwd||root,env,encoding:'utf8',windowsHide:true,maxBuffer:12*1024*1024});
 const log='gate-'+test.id.replace(/[^a-zA-Z0-9.-]/g,'-')+'.log';fs.writeFileSync(path.join(out,log),(result.stdout||'')+'\n'+(result.stderr||'')+(result.error?'\n'+result.error.message:''));
 const item={id:test.id,layer:test.layer,status:result.status===0?'PASSED':'FAILED',exitCode:result.status,durationMs:Date.now()-started,log};report.tests.push(item);save();console.log(item.id+': '+item.status+' ('+Math.round(item.durationMs/1000)+'s)');
}
report.finishedAt=new Date().toISOString();report.automatedGatePassed=report.tests.every(t=>t.status==='PASSED');save();process.exitCode=report.automatedGatePassed?0:1;
