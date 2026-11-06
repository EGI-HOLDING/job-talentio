// Isolated production preview. Does not edit .env or connect to the VPS.
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');process.chdir(root);
const {env,url,name}=require('./business-catalog-local.cjs');url.pathname='/'+name;
const mode=process.argv[2];
const childEnv={...process.env,...env,DATABASE_URL:url.toString(),HR_CREATION_V2_ENABLED:'true',HR_FLOW_MARKET:'id',EMPLOYEE_EXPERIENCE_POLICY_ENABLED:'true',EMPLOYEE_VACANCY_TASK_VERSION:'vacancy-tasks-v3',EMPLOYEE_RECOMMENDATION_V32_ENABLED:'true',EMPLOYEE_INTENT_V3_MODE:'enabled',EMPLOYEE_VACANCY_TASK_MODE:'enabled',CATALOG_SOURCE_MODE:'database',TARA_SCREENING_ENABLED:'false',HR_EVIDENCE_V2_ENABLED:'false',SUPERADMIN_PASSWORD:'',REDIS_URL:'redis://127.0.0.1:6381/15',DEMO_LOGO_BACKFILL_ENABLED:'false',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHANNEL_ID:'',MEILI_JOBS_INDEX:'hr-flow-local-jobs',WEB_URL:'http://localhost:3000',FRONTEND_URL:'http://localhost:3000',JWT_SECRET:'hr-flow-local-only-signing-secret-for-isolated-tests',JWT_REFRESH_SECRET:'hr-flow-local-only-refresh-secret-for-isolated-tests',NEXT_PUBLIC_HR_CREATION_V2:'true',NEXT_PUBLIC_API_URL:'http://localhost:4000',NEXT_BUILD_DIR:'.next-hr-flow',S3_BUCKET:'talentio-hr-flow-local-test',PORT:'4000',NODE_ENV:'production',CHECKOUT_TEST_MODE:'false'};
if(childEnv.S3_ENDPOINT){const endpoint=new URL(childEnv.S3_ENDPOINT);if(!['localhost','127.0.0.1'].includes(endpoint.hostname))throw Error('Local object storage only');childEnv.S3_PUBLIC_URL=endpoint.origin+'/'+childEnv.S3_BUCKET;}
const runs={smoke:['apps/api',['dist/scripts/hr-flow-production-smoke.js','--expected-database='+name]],api:['apps/api',['dist/main.js']],web:['apps/web',['node_modules/next/dist/bin/next','start','-p','3000']],'web-build':['apps/web',['node_modules/next/dist/bin/next','build']]};
if(!runs[mode])throw Error('Choose api, web-build, or web');
const [cwd,args]=runs[mode];const child=spawn(process.execPath,args,{cwd:path.join(root,cwd),env:childEnv,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);child.on('error',error=>{console.error(error.message);process.exitCode=1;});process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));
