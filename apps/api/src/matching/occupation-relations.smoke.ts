import assert from 'node:assert/strict';
import {buildProfessionGraph,type ProfessionSource} from './occupation-relations';
import {EmployeeOccupationIndex,type IntentRole} from './employee-occupation';
let passed=0;const check=(v:unknown,m:string)=>{assert.ok(v,m);passed++;};
const roles:IntentRole[]=[],source:ProfessionSource={source:'Deterministic occupational task fixtures',sourceVersion:'v1.2.1',sourceUrl:'fixture',occupations:[],skills:[{uri:'communication',label:'Communication',reuse:'transversal',type:'skill'},{uri:'knowledge',label:'General subject knowledge',reuse:'sector-specific',type:'knowledge'}]};
const families=['343','241','251','214','222','234','833','514','216','741'];
for(let n=0;n<families.length;n++){
 const task='task:'+n;source.skills.push({uri:task,label:'Specific work task '+n,reuse:'occupation-specific',type:'skill'});
 for(const suffix of ['a','b']){const id=n+suffix,uri='http://data.europa.eu/esco/occupation/'+id;roles.push({id,name:'Profession '+id,familyId:suffix==='a'?families[n]:'related:'+families[n],family:{id:suffix==='a'?families[n]:'related:'+families[n],name:'Family',archivedAt:null},canonicalRoleId:null,matchingApproved:true,matchingMetadata:{sources:[{uri}]},aliases:[]});source.occupations.push({uri,label:'Profession '+id,aliases:[],description:'Profession work description '+id,scopeNote:'',essential:[{uri:task,label:task},{uri:'communication',label:'Communication'},{uri:'knowledge',label:'General knowledge'}],optional:[]});}
}
const graph=buildProfessionGraph(roles,source),pairs=new Set(graph.relations.map(r=>r.fromRoleId+':'+r.toRoleId));
for(let n=0;n<families.length;n++){check(pairs.has(n+'a:'+n+'b'),'shared essential work tasks link professions in family '+families[n]);check(!pairs.has(n+'a:'+((n+1)%10)+'b'),'communication and knowledge alone never link unrelated professions');}
check(graph.report.positionsProcessed===20&&graph.report.crossFamily===20,'all ten families are processed and cross-family links are supported');
check(graph.id===buildProfessionGraph([...roles].reverse(),source).id,'catalog ordering does not affect graph release identity');
const projected=roles.map(r=>({...r,matchingMetadata:{relatedRoles:graph.relations.filter(e=>e.fromRoleId===r.id).map(e=>({id:e.toRoleId,kind:'RELATED',approved:true,reference:'fixture:task-evidence'}))}}));
const index=new EmployeeOccupationIndex(projected,true);
check(index.eligibility(['0a'],'0a').matchType==='EXACT'&&index.eligibility(['0a'],'0b').matchType==='RELATED','exact identity and related profession remain distinct');
check(index.eligibility(['0a','1a','2a','3a','4a'],'4b').eligible&&!index.eligibility(['0a','1a','2a','3a','4a'],'9b').eligible,'five choices work without creating unrelated combinations');
const asymmetric=structuredClone(source);asymmetric.skills.push({uri:'extra',label:'Additional target task',reuse:'occupation-specific',type:'skill'});asymmetric.occupations.find(p=>p.label==='Profession 0b')!.essential.push({uri:'extra',label:'Extra task'});const directed=buildProfessionGraph(roles,asymmetric);check(directed.relations.find(r=>r.fromRoleId==='0a'&&r.toRoleId==='0b')!.score<directed.relations.find(r=>r.fromRoleId==='0b'&&r.toRoleId==='0a')!.score,'directional target competency coverage is evaluated independently');
const missing=structuredClone(roles);missing[0].name='Local profession without a source';missing[0].matchingMetadata={};const incomplete=buildProfessionGraph(missing,source);check(incomplete.report.positionsProcessed===20&&incomplete.report.sourceMissing.some(r=>r.id==='0a'),'missing source is reported without dropping the profession from coverage');
const canonical={...roles[0],id:'alias',canonicalRoleId:roles[0].id,name:'Official synonym',aliases:[]};check(buildProfessionGraph([...roles,canonical],source).profiles.find(p=>p.jobTitleId==='alias')?.sourceUri===graph.profiles.find(p=>p.jobTitleId==='0a')?.sourceUri,'canonical synonym reuses the same occupational profile without changing historical IDs');
const unavailable=structuredClone(roles);unavailable[0].matchingMetadata={professionSourceUri:'http://data.europa.eu/esco/occupation/unavailable'};check(buildProfessionGraph(unavailable,source).profiles[0].sourceUri===null,'an explicit source binding is never silently replaced by a title guess');
const newRole:IntentRole={...roles[0],id:'new-local-title',name:'New regional occupation',matchingMetadata:{
  professionSourceUri:source.occupations[0].uri,
  professionTaskProfile:{scope:'Carry out the defined specific work task.',evidence:'Verified occupational description',skillUris:['task:0']},
}};
const added=buildProfessionGraph([...roles,newRole],source);
const scopedProfile=added.profiles.find(row=>row.jobTitleId===newRole.id);
check(scopedProfile?.mappingMethod==='ADMIN_TASK_PROFILE'&&scopedProfile.facts.essential.length===1,'new titles use the same graph with a scoped source profile');
check(added.relations.some(row=>row.fromRoleId==='0a'&&row.toRoleId===newRole.id&&row.basis.kind==='RELATED'),'new sourced roles gain relations without pair approvals');
const invalid={...newRole,matchingMetadata:{...newRole.matchingMetadata as object,professionTaskProfile:{scope:'Incompatible task outside the source reference',evidence:'Fixture',skillUris:['task:9']}}};
check(buildProfessionGraph([...roles,invalid],source).profiles.find(row=>row.jobTitleId===newRole.id)?.sourceUri===null,'a mismatched skill cannot be borrowed from an unrelated occupation');
console.log(JSON.stringify({suite:'profession-relations',passed,families:families.length}));
