const path=require('node:path');
const {spawnSync}=require('node:child_process');
process.chdir(path.resolve(__dirname,'..'));
const {api,env,url,name}=require('./business-catalog-local.cjs');
url.pathname='/'+name;
const file=process.argv[2];
if(!file||!file.startsWith('apps/api/src/'))throw Error('An API source script is required');
const result=spawnSync(process.execPath,[path.resolve('apps/api/node_modules/tsx/dist/cli.mjs'),'--tsconfig',path.resolve('apps/api/tsconfig.json'),path.resolve(file),...process.argv.slice(3)],{
 stdio:'inherit',windowsHide:true,env:{...process.env,...env,DATABASE_URL:url.toString(),EMPLOYEE_EXPERIENCE_POLICY_ENABLED:'true',REDIS_URL:'redis://127.0.0.1:6381',CATALOG_SOURCE_MODE:'database'},
});
if(result.error)throw result.error;process.exitCode=result.status??1;
