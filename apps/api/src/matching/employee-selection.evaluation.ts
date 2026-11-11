import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildProfessionGraph} from './occupation-relations';
import {loadProfessionSource} from './occupation-relations.service';
import {EmployeeOccupationIndex,type IntentRole} from './employee-occupation';
import {VacancyTasksService} from './vacancy-tasks.service';
import {vacancyTaskEvidenceVersion} from './vacancy-tasks';

type Case = [family:string,source:string,related:string,unrelated:string,rationale:string];
const data=join(__dirname,'../../prisma/data');
const fixture=JSON.parse(readFileSync(join(data,'occupation-profiles/selection-evaluation-v1.json'),'utf8')) as {version:string;cases:Case[]};
const input=JSON.parse(readFileSync(join(data,'job-titles/audit-2026-10-24.json'),'utf8').replace(/^\uFEFF/,''));
const familyByUri=new Map<string,string>(input.rows.filter((r:any)=>r.source?.uri&&r.source?.isco08).map((r:any)=>[r.source.uri,r.source.isco08.slice(0,3)]));
const source=loadProfessionSource();
const occupations=new Map(source.occupations.map(row=>[row.label.toLowerCase(),row]));
const skills=new Map(source.skills.map(skill=>[skill.uri,skill]));
const roles:IntentRole[]=source.occupations.map(row=>{
 const familyId=familyByUri.get(row.uri)!;
 return {id:row.uri,name:row.label,familyId,canonicalRoleId:null,matchingApproved:true,aliases:[],family:{id:familyId,name:familyId,archivedAt:null},matchingMetadata:{sources:[{uri:row.uri}]}};
});
const noNetwork=()=>{throw Error('Network is disabled for task selection evaluation');};
globalThis.fetch=noNetwork as typeof fetch;
const graph=buildProfessionGraph(roles,source);
const byRole=new Map(graph.profiles.map(row=>[row.jobTitleId,row]));
const bySource=new Map<string,typeof graph.relations>();
for(const row of graph.relations){const list=bySource.get(row.fromRoleId)??[];list.push(row);bySource.set(row.fromRoleId,list);}
const index=new EmployeeOccupationIndex(roles.map(role=>({...role,matchingMetadata:{relatedRoles:(bySource.get(role.id)??[]).filter(row=>row.basis.kind==='RELATED').map(row=>({id:row.toRoleId,kind:'RELATED',approved:true,reference:'evaluation:graph',score:row.score}))}})),true);
// Use the production selector against a fixed in-memory snapshot. The SQL and
// authenticated HTTP paths are exercised separately against PostgreSQL.
const db={
 occupationProfessionProfile:{findMany:async({where}:any)=>where.jobTitleId.in.map((id:string)=>byRole.get(id)).filter(Boolean)},
 occupationRelationOverride:{findMany:async()=>[]},
 occupationProfessionRelation:{findMany:async({where}:any)=>where.fromRoleId.in.flatMap((id:string)=>bySource.get(id)??[]).filter((row:any)=>where.toRoleId.in.includes(row.toRoleId))},
};
const version=vacancyTaskEvidenceVersion(source.taskVocabularyDigest);
const tasks=new VacancyTasksService(db as any,{loadSource:()=>source,taskVersion:()=>version} as any);
const now=new Date('2026-11-11T00:00:00.000Z');
const types=['structured','english-bullets','indonesian-heading','html-list','mixed','inline-heading','reordered','unheaded','descriptive','with-requirements'] as const;
function postings(target:NonNullable<ReturnType<typeof occupations.get>>,candidate:NonNullable<ReturnType<typeof occupations.get>>,key:string){
 const duties=target.essential.filter(row=>skills.get(row.uri)?.type==='skill').map(row=>row.label);
 const inline=duties.join('. ')+'.';
 return types.map((kind,i)=>{
   let description=target.description,responsibilities:string[]=[];
   switch(kind){
    case 'structured': responsibilities=duties;break;
    case 'english-bullets': description='Key responsibilities\n'+duties.map(d=>'- '+d).join('\n');break;
    case 'indonesian-heading': description='Tanggung jawab utama\n'+duties.map(d=>'• '+d).join('\n');break;
    case 'html-list': description='<h3>Responsibilities</h3><ul>'+duties.map(d=>'<li>'+d+'</li>').join('')+'</ul>';break;
    case 'mixed': description='Role overview\n'+description+'\nTugas utama\n'+duties.map(d=>'• '+d+'.').join('\n');break;
    case 'inline-heading': description='Responsibilities: '+inline;break;
    case 'reordered': responsibilities=[...duties].reverse();break;
    case 'unheaded': description=duties.map(d=>d.charAt(0).toUpperCase()+d.slice(1)).join('\n');break;
    case 'descriptive': description='Position overview\n'+description;break;
    case 'with-requirements': description='Responsibilities\n'+duties.join('\n')+'\nRequirements\n'+candidate.essential.map(row=>row.label).join('\n');break;
   }
   return tasks.project({id:key+':'+i,jobTitleId:target.uri,description,responsibilities,updatedAt:now});
 });
}
async function main(){
 const families=new Set<string>(),cases=[];
 const byFamily=new Map<string,{tp:number;tn:number;fp:number;fn:number;independentPairs:number}>();
 let tp=0,tn=0,fp=0,fn=0;
 for(const [family,candidateName,positiveName,negativeName,rationale] of fixture.cases){
   const candidate=occupations.get(candidateName.toLowerCase()),positive=occupations.get(positiveName.toLowerCase()),negative=occupations.get(negativeName.toLowerCase());
   assert.ok(candidate&&positive&&negative,'Unknown ESCO fixture: '+[candidateName,positiveName,negativeName].filter(name=>!occupations.has(name.toLowerCase())).join(', '));
   assert.equal(familyByUri.get(candidate.uri),family,'Fixture family for '+candidateName);
   assert.ok(rationale.trim());families.add(family);
   const rows=[...postings(positive,candidate,'yes'),...postings(negative,candidate,'no')];
   const result=await tasks.select(index,[candidate.uri],[],graph.id,rows,version);
   const missed=rows.filter(row=>row.id.startsWith('yes:')&&!result.decisions.has(row.id));
   const leaked=rows.filter(row=>row.id.startsWith('no:')&&result.decisions.has(row.id));
   tp+=types.length-missed.length;tn+=types.length-leaked.length;fp+=leaked.length;fn+=missed.length;
   const counts=byFamily.get(family)??{tp:0,tn:0,fp:0,fn:0,independentPairs:0};
   counts.tp+=types.length-missed.length;counts.tn+=types.length-leaked.length;counts.fp+=leaked.length;counts.fn+=missed.length;counts.independentPairs+=2;byFamily.set(family,counts);
   const edge=(id:string)=>bySource.get(candidate.uri)?.find(row=>row.toRoleId===id)?.basis;
   const known=result.decisions.get(leaked[0]?.id)?.eligibility;
   cases.push({family,candidate:candidateName,related:positiveName,unrelated:negativeName,missed:missed.map(row=>types[Number(row.id.split(':')[1])]),leaked:leaked.map(row=>types[Number(row.id.split(':')[1])]),
     ...(missed.length?{relatedGraph:edge(positive.uri),exampleMissedRecognized:missed[0].keys.length}:{}),
     ...(known?{leakEvidence:known.selectionEvidence,leakTasks:known.taskConceptIds?.map(id=>skills.get(id)?.label??id)}:{})});
 }
 const precision=tp/(tp+fp),recall=tp/(tp+fn);
 const allFamilies=new Set(familyByUri.values());
 const perFamily=[...byFamily].sort(([a],[b])=>a.localeCompare(b)).map(([family,counts])=>({family,...counts,precision:counts.tp+counts.fp?counts.tp/(counts.tp+counts.fp):null,recall:counts.tp/(counts.tp+counts.fn)}));
 const report={version:fixture.version,families:families.size,occupationPairs:fixture.cases.length*2,postingPairs:tp+tn+fp+fn,precision,recall,tp,tn,fp,fn,perFamily,untestedSourceFamilies:[...allFamilies].filter(family=>!families.has(family)).sort(),cases};
 if(process.env.SELECTION_EVALUATION_REPORT)writeFileSync(process.env.SELECTION_EVALUATION_REPORT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,cases:undefined,perFamily:undefined}));
 assert.ok(report.postingPairs>=600&&families.size>=30,'Required evaluation coverage');
 assert.ok(precision>=.95&&recall>=.95,'Locked evaluation requires both precision and recall of at least 95%');
}
void main().catch(error=>{console.error(error.message);process.exitCode=1});
