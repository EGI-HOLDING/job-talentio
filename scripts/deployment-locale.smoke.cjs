const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');const {execFileSync}=require('node:child_process');
const req=createRequire(path.resolve('apps/api/package.json')),ts=req('typescript');
function load(file,env,modules={}) {
 const exports={};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports,process:{env},URL,require:name=>{assert.ok(name in modules,name);return modules[name];}},{filename:file});return exports;
}
const url='https://cari-kerja.co.id';
function middlewareFor(env){
 const locale=load('apps/web/src/lib/locale.ts',env);
 const make=(kind,destination)=>({kind,destination:destination?.toString(),cookieWrites:[],cookies:{set(...args){this.owner.cookieWrites.push(args);}}});
 const response=(kind,dest)=>{const r=make(kind,dest);r.cookies.owner=r;return r;};
 const {middleware}=load('apps/web/src/middleware.ts',env,{'@/lib/locale':locale,'next/server':{NextResponse:{redirect:u=>response('redirect',u),next:()=>response('next')}}});
 return (target,cookie,header)=>{const nextUrl=new URL(target,url);nextUrl.clone=()=>new URL(nextUrl);return middleware({url:nextUrl.toString(),nextUrl,cookies:{get:key=>key==='jt_locale'&&cookie!==undefined?{value:cookie}:undefined},headers:{get:key=>key==='accept-language'?header:null}});};
}
const vps={NEXT_PUBLIC_DEFAULT_LOCALE:'id',NEXT_PUBLIC_LOCALE_DETECTION:'default'};
const run=middlewareFor(vps);
for(const header of [undefined,'en-US,en;q=0.9','ru-RU','uz-UZ'])for(const target of ['/','/jobs?q=React','/login?role=RECRUITER']){
 const actual=new URL(run(target,undefined,header).destination),original=new URL(target,url);
 assert.equal(actual.pathname,original.pathname==='/'?'/id':'/id'+original.pathname);assert.equal(actual.search,original.search);
}
assert.equal(new URL(run('/', 'invalid','en').destination).pathname,'/id');
for(const locale of ['id','en','ru','uz']){
 assert.equal(new URL(run('/jobs',locale,'en').destination).pathname,`/${locale}/jobs`);
 const response=run(`/${locale}/jobs?x=1`,'id','en');assert.equal(response.kind,'next');
 if(locale!=='id'){assert.equal(response.cookieWrites[0][0],'jt_locale');assert.equal(response.cookieWrites[0][1],locale);}
}
const legacy=middlewareFor({});
assert.equal(new URL(legacy('/',undefined,'en-US').destination).pathname,'/en');
assert.equal(new URL(legacy('/',undefined,'ru-RU').destination).pathname,'/ru');
assert.equal(new URL(legacy('/',undefined,undefined).destination).pathname,'/uz');
assert.equal(new URL(legacy('/jobs','id','en-US').destination).pathname,'/id/jobs');
const fallback=load('apps/web/src/lib/locale.ts',{NEXT_PUBLIC_DEFAULT_LOCALE:'invalid',NEXT_PUBLIC_LOCALE_DETECTION:'invalid'});
assert.equal(fallback.DEFAULT_LOCALE,'uz');assert.equal(fallback.pickLocale(null,'en'),'en');
const browser=load('apps/web/src/lib/locale.ts',{NEXT_PUBLIC_DEFAULT_LOCALE:'id'});assert.equal(browser.pickLocale(null,'en'),'en');
console.log('PASS middleware: VPS Indonesian first, URL/cookie precedence, invalid cookie, query preservation, optional configuration and legacy browser behavior');
for(const value of [undefined,'id','invalid']){
 const env={...process.env};delete env.APP_DEFAULT_LOCALE;if(value!==undefined)env.APP_DEFAULT_LOCALE=value;
 const output=execFileSync(process.execPath,[req.resolve('tsx/cli'),'--tsconfig',path.resolve('apps/api/tsconfig.json'),path.resolve('apps/api/src/auth/registration-locale.smoke.ts')],{env,encoding:'utf8',windowsHide:true});
 process.stdout.write(output);
}
