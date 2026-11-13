// Isolated PostgreSQL integration with synthetic CVs and a mocked AI provider. No paid API calls.
const {execFileSync,spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');const path=require('node:path');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
const info=JSON.parse(execFileSync('docker',['inspect','jt-postgres'],{encoding:'utf8',windowsHide:true}))[0];
const settings=Object.fromEntries(info.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
const name='talentio_recruitment_it_'+Date.now(),user=settings.POSTGRES_USER||'postgres',port=info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
if(!/^talentio_recruitment_it_\d+$/.test(name)||port!=='5434')throw Error('Disposable local DB guard failed');
const env={...process.env,NODE_ENV:'test',DATABASE_URL:`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(settings.POSTGRES_PASSWORD)}@127.0.0.1:${port}/${name}`,TARA_SCREENING_ENABLED:'false',TAKA_ROLE_ASSESSMENT_ENABLED:'false',HR_RANKING_V2_MODE:'off',EMPLOYEE_INTENT_V3_MODE:'off',OPENAI_API_KEY:'',TELEGRAM_BOT_TOKEN:'',RESEND_API_KEY:''};
function run(file,args,quiet=false){const r=spawnSync(process.execPath,[file,...args],{cwd:root,env,stdio:quiet?'pipe':'inherit',encoding:'utf8',windowsHide:true});if(r.status!==0){if(quiet)console.error(r.stdout,r.stderr);throw Error('Recruitment check failed ('+r.status+')');}if(quiet)console.log('All migrations applied successfully to isolated local database.');}
function screeningTest(file){
  run(req.resolve('tsx/cli'),['--tsconfig','apps/api/tsconfig.json','apps/api/src/ai-screening/'+file]);
}
try{
  execFileSync('docker',['exec','jt-postgres','createdb','-U',user,name],{windowsHide:true});
  run(req.resolve('prisma/build/index.js'),['migrate','deploy','--schema','apps/api/prisma/schema.prisma'],true);
  screeningTest('role-assessment.smoke.ts');
  if (process.argv.includes('--taka-interview-only')) {
    ['taka-interview.smoke.ts','tara-timed-interview.smoke.ts','voice/voice-evidence.smoke.ts','voice/voice-native.smoke.ts','recruitment/invitations.integration.smoke.ts'].forEach(screeningTest);
  } else {
    if (!process.argv.includes('--taka-only')) {
      ['voice/voice-evidence.smoke.ts','taka-interview.smoke.ts'].forEach(screeningTest);
      for(const test of ['cv-scoring.smoke.ts','invited-conversation.smoke.ts','recruitment.integration.smoke.ts','cv-staleness.integration.smoke.ts','invitations.integration.smoke.ts','candidate-actions.integration.smoke.ts']) {
        screeningTest('recruitment/'+test);
      }
    }
    screeningTest('recruitment/cv-document.smoke.ts');
    screeningTest('recruitment/cv-assessment.integration.smoke.ts');
  }
}finally{execFileSync('docker',['exec','jt-postgres','dropdb','-U',user,'--force','--if-exists',name],{windowsHide:true});}
