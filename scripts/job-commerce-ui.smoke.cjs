const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const {host,nodes,text}=require('./lib/react-hook-host.cjs');
const root=path.resolve(__dirname,'..'),web=createRequire(path.join(root,'apps/web/package.json')),ts=web('typescript'),moduleObject={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/lib/i18n/dict/jobCommerce.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleObject,exports:moduleObject.exports});
const dict=moduleObject.exports.jobCommerce,stub=()=>null;
const packages=['FREE','STANDARD','PREMIUM'].map((code,index)=>({code,amount:[0,149000,299000][index],currency:'IDR',version:1,settings:{durationDays:30,boostDays:[0,3,7][index],featuredDays:[0,7,30][index],conversions:index>0,reports:index===2,prioritySupport:index===2},linkedin:index===2,instagram:index===2?'COMING_SOON':'NOT_INCLUDED'}));
function dependencies(locale){return {'@/lib/api':{api:async()=>{throw Error('A supplied catalog needs no request');}},'@/lib/navigation':{Link:stub,useRouter:()=>({push(){}})},'@/lib/i18n':{useI18n:()=>({t:key=>dict[key]?.[locale]||key,locale})},'@/lib/jobCommerce':{money:amount=>'Rp '+amount,withPackagePreference:(href,code)=>href+'&package='+code},'@/components/employee/WorkspacePrimitives':{WorkspaceLoading:stub}};}
for(const locale of ['id','en','ru','uz'])test('Pricing describes future AI without active quotas in '+locale,async()=>{
  const ui=host('apps/web/src/components/recruiter/PackagePricing.tsx','PackagePricing',dependencies(locale));
  const tree=await ui.render({catalog:{version:1,packages,testMode:true,paymentAvailable:false}}),cards=nodes(tree,n=>n.type==='article');
  assert.equal(cards.length,3);
  for(const [i,key] of ['basic','aiRecommendations','advancedAiRecommendations'].entries())assert.ok(text(cards[i]).includes(dict['commerce.'+key][locale]));
  assert.ok(!text(cards[0]).includes(dict['commerce.planned'][locale]));
  for(const card of cards.slice(1))assert.ok(text(card).includes(dict['commerce.planned'][locale]));
  assert.ok(text(tree).includes(dict['commerce.recommendationsPlanned'][locale]));
  for(const list of nodes(tree,n=>n.type==='ul'))assert.doesNotMatch(text(list),/\b(?:10|30|100)\s+(?:kandidat|candidates|кандидатов|nomzod)\b/i);
  ui.unmount();
});
