const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {api}=require('./business-catalog-local.cjs');
const ts=api('typescript');
const files=['catalogs/business-catalog.baseline.ts','matching/employee-intent.ts','meta/meta.service.ts','companies/companies.service.ts','jobs/jobs.service.ts'];
fs.mkdirSync('output/business-catalog/legacy',{recursive:true});
fs.writeFileSync('output/business-catalog/legacy/tsconfig.json',JSON.stringify({compilerOptions:{experimentalDecorators:true,emitDecoratorMetadata:true,target:'ES2022',module:'commonjs',esModuleInterop:true}},null,2));
for(const file of files.slice(1)){
 const name='apps/api/src/'+file;
 let source=execFileSync('git',['show','HEAD:'+name],{encoding:'utf8'});
 source=source.replace(/from (['"])([^'"]+)\1/g,(_match,quote,specifier)=>{
  if(specifier.startsWith('node:'))return `from ${quote}${specifier}${quote}`;
  const resolved=specifier.startsWith('.')?path.resolve(path.dirname(name),specifier):api.resolve(specifier);
  return `from ${quote}${resolved.replaceAll('\\','/')}${quote}`;
 });
 const built=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}});
 fs.writeFileSync('output/business-catalog/legacy/'+path.basename(file).replace(/\.ts$/,'.cjs'),built.outputText);
}
console.log('Prepared read-only HEAD implementations for side-by-side benchmark');
