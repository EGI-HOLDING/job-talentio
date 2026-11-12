import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildPositionGroups,positionRoleRevision,type GroupDefinition} from './position-groups';
import {PositionGroupOccupationIndex} from './position-group-index';
import {EmployeeOccupationIndex,type IntentRole} from './employee-occupation';
import {indonesiaProfessionDefinitions,professionWorkScopes} from './indonesia-profession-definitions';
import {type ProfessionSource} from './occupation-relations';
import {evaluateIntent,compareIntent} from './employee-intent';
import {benchmarkRoles,benchmarkJob,makeEmployeeBenchmark} from './employee-intent.benchmark';

const directory=join(__dirname,'../../prisma/data');
const audit=JSON.parse(readFileSync(join(directory,'job-titles/audit-2026-10-24.json'),'utf8'));
const source={...JSON.parse(gunzipSync(readFileSync(join(directory,'occupation-profiles/esco-v1.2.1.json.gz'))).toString('utf8')),localDefinitions:indonesiaProfessionDefinitions,workScopes:professionWorkScopes} as ProfessionSource;
const heads=JSON.parse(readFileSync(join(directory,'position-groups/heads-v1.json'),'utf8')).heads as GroupDefinition[];
const labels=JSON.parse(readFileSync(join(directory,'position-groups/english-labels-v1.json'),'utf8'));
const roles:IntentRole[]=audit.rows.map((r:any)=>{const code=r.source?.isco08??'9999';return {id:r.targetId,name:r.name,nameId:r.nameId,familyId:'isco:'+code.slice(0,3),family:{id:'isco:'+code.slice(0,3),name:'Source family',archivedAt:null},canonicalRoleId:null,matchingApproved:true,aliases:(r.aliases??[]).map((alias:string)=>({alias,matchingApproved:true})),matchingMetadata:{sources:r.source?.uri?[r.source]:[]}};});
for(const name of ['Admin Pesanan Produk Pangan','Eksekutif Penjualan Armada','Koordinator Proyek Energi','Insinyur Proyek Tenaga Surya']){
  if(roles.some(role=>role.name===name))continue;
  const familyId='local-fixture';
  roles.push({id:'fixture:'+name,name,familyId,family:{id:familyId,name:'Fixture family',archivedAt:null},canonicalRoleId:null,matchingApproved:true,aliases:[]});
}
let checks=0;
const check=(value:unknown,message:string)=>{assert.ok(value,message);checks++;};
const graph=buildPositionGroups(roles,source,heads,labels);
check(graph.heads.length===99,'all approved group definitions are preserved');
check(graph.report.positionsProcessed===roles.length,'every catalog row has a disposition');
check(graph.report.dispositions.length===roles.length,'dispositions cover the full source');
const byName=new Map(roles.map(r=>[r.name.toLowerCase(),r]));
// Expected selections are authored independently from the importer and membership rules.
const expectedHeads=`Accountant|Administrative Assistant|Agricultural Technician|Agronomist|Air Traffic Controller|Animal Care Attendant|Animal Handler|Animal Trainer|Architect|Audio-visual Technician|Baker|Bank Teller|Barista|Bartender|Biologist|Bookkeeper|Business Analyst|Call Centre Agent|Carpenter|Cashier|Chef|Chemist|Child Care Worker|Civil Engineer|Construction Manager|Cook|Customer Service Representative|Data Analyst|Data Engineer|Data Entry Clerk|Data Scientist|Database Administrator|Designer|DevOps Engineer|Doctor|Driver|Economist|Electrician|Engineer|Environmental Engineer|Event Manager|Farm Manager|Fashion Designer|Financial Analyst|Financial Manager|Firefighter|Fitness Instructor|Forklift Operator|Geologist|Graphic Designer|Hairdresser|Health And Safety Officer|Healthcare Assistant|Human Resources Specialist|Industrial Designer|Industrial Engineer|Industrial Production Manager|Interior Designer|IT Support Specialist|Journalist|Lawyer|Legal Assistant|Logistics Coordinator|Machine Operator|Marketing Manager|Marketing Specialist|Midwife|Musician|Nurse|Office Clerk|Operations Manager|Pharmacist|Photographer|Plumber|Police Officer|Product Manager|Production Supervisor|Project Manager|Psychologist|Quality Engineer|Receptionist|Restaurant Manager|Sales|Security Guard|Ship Captain|Social Worker|Software Developer|Software Tester|Statistician|Supply Chain Manager|Teacher|Translator|Veterinary Technician|Waiter/waitress|Warehouse Worker|Web Developer|Welder|Wholesale Merchant|Writer`.split('|');
const genericExamples:Record<string,string>={Designer:'Graphic Designer',Doctor:'General Practitioner',Driver:'Bus Driver',Engineer:'Civil Engineer','Human Resources Specialist':'Human Resources Officer','IT Support Specialist':'ICT Help Desk Agent','Machine Operator':'Coating Machine Operator','Marketing Specialist':'Marketing Manager',Nurse:'Nurse Responsible for General Care',Sales:'Commercial Sales Representative',Teacher:'Primary School Teacher'};
function member(group:string,title:string){const role=byName.get(title.toLowerCase());assert.ok(role,'Fixture title exists: '+title);return graph.memberships.some(m=>m.groupId===group&&m.jobTitleId===role.id);}
for(const name of expectedHeads){const group=graph.heads.find(h=>h.nameEn===name);assert.ok(group,'Approved group '+name);check(member(group.id,genericExamples[name]??name),'independent positive example for '+name);check(!member(group.id,name==='Pharmacist'?'Chef':'Pharmacist'),'independent incompatible example for '+name);}
for(const head of heads){check(Boolean(head.definition&&head.scope),'group has occupational definition '+head.nameEn);if(head.sourceRoleId)check(graph.memberships.some(m=>m.groupId===head.id&&m.jobTitleId===head.sourceRoleId),'existing head belongs to its own search scope '+head.nameEn);}
for(const title of ['Chef','Head Chef','Pastry Chef'])check(member('group:chef',title),'Chef includes '+title);
for(const title of ['Cook','Diet Cook','Fish Cook'])check(member('group:cook',title),'Cook includes '+title);
check(!member('group:chef','Cook')&&!member('group:cook','Chef'),'Chef and Cook remain separate');
for(const title of ['Sales Manager','Commercial Sales Representative','Sales Engineer','Medical Sales Representative','Sales Assistant','Computer And Accessories Specialised Seller','Eksekutif Penjualan Armada'])check(member('group:sales',title),'Sales includes the selling occupation '+title);
for(const title of ['After-sales Service Technician','Aftersales Service Manager','Accountant','Pharmacist','Sales Processor','Sales Support Assistant','Admin Pesanan Produk Pangan','Commercial Art Gallery Manager'])check(!member('group:sales',title),'Sales rejects unrelated/support task '+title);
check(member('group:engineer','Insinyur Proyek Tenaga Surya')&&!member('group:engineer','Koordinator Proyek Energi'),'Engineering delivery owns the engineered output; schedule coordination does not');
check(!member('group:engineer','Gambling Quality Assurance Engineer'),'Operating tests on gambling products is not engineering');
check(member('group:machine-operator','Textile Finishing Machine Operator')&&!member('group:machine-operator','Vending Machine Operator')&&!member('group:machine-operator','Machine Operator Supervisor'),'Actual production machinery operation is required');
const admin=byName.get('admin pesanan produk pangan')!;
const reviewed={groupId:'group:sales',jobTitleId:admin.id,enabled:true,reason:'Reviewed occupational scope',source:{workScope:'Documented ownership of customer sales and negotiations.',reference:'fixture:source',roleRevision:positionRoleRevision(admin)}};
check(buildPositionGroups(roles,source,heads,labels,[reviewed]).memberships.some(m=>m.jobTitleId===admin.id&&m.groupId===reviewed.groupId),'a positive catalog correction records role-specific work proof');
check(!buildPositionGroups(roles,source,heads,labels,[{...reviewed,source:{...reviewed.source,roleRevision:'stale'}}]).memberships.some(m=>m.jobTitleId===admin.id&&m.groupId===reviewed.groupId),'an old correction cannot widen the scope after the role revision changes');
check(member('group:doctor','General Practitioner')&&!member('group:doctor','Medical Sales Representative'),'doctor work differs from selling medical products');
check(!member('group:nurse','Nursing Lecturer'),'nursing teaching is not patient nursing');
check(!member('group:designer','Database Designer'),'generic design scope does not include database architecture through its title');
check(!member('group:marketing-manager','Sales Manager')&&!member('group:marketing-specialist','Sales Manager'),'source hierarchy and shared business skills do not turn sales management into marketing work');
const repeated=buildPositionGroups([...roles].reverse(),source,heads,labels);
check(graph.id===repeated.id&&graph.checksum===repeated.checksum,'release is deterministic across catalog row order');

const dataset=makeEmployeeBenchmark(),now=new Date('2026-11-03');
for(let family=0;family<10;family++){
  const original=structuredClone(benchmarkRoles[family]),related=structuredClone(benchmarkRoles[(family+1)%10]);
  original.matchingMetadata={relatedRoles:[{id:related.id,kind:'RELATED',approved:true,reference:'fixture:task-evidence',score:0.7}]};
  const groups=[{id:'group:'+family,nameEn:original.name,members:[original.id]}];
  const index=new PositionGroupOccupationIndex([original,related],[],groups,'release-one');
  check(index.eligibility(index.expandedIds,original.id).matchType==='GROUP','member is GROUP rather than EXACT '+family);
  check(index.eligibility(index.expandedIds,related.id).matchType==='RELATED','one direct related profession remains available '+family);
  const specific=new PositionGroupOccupationIndex([original,related],[original.id],groups,'release-one');
  check(specific.eligibility(specific.expandedIds,original.id).matchType==='EXACT','explicit role wins over overlap '+family);
  const plain=new EmployeeOccupationIndex([original,related],true),profile=dataset.profiles[family*6+1],job=benchmarkJob(family,1);
  const exact=evaluateIntent({...profile.preferences,selectedIds:[original.id]},profile.facts,job,plain,now);
  const grouped=evaluateIntent({...profile.preferences,selectedIds:index.expandedIds},profile.facts,job,index,now);
  check(exact.score===grouped.score&&exact.tier===grouped.tier,'membership adds no professional score bonus '+family);
  check(compareIntent(exact,grouped)<0,'exact precedes group within main results '+family);
  const overlap=new PositionGroupOccupationIndex([original,related],[],Array.from({length:5},(_,n)=>({id:'group:'+n,nameEn:'Group '+n,members:[original.id]})).reverse(),'release-one');
  check(overlap.expandedIds.length===1,'five overlapping choices do not multiply members '+family);
  const unrelatedExperience={...profile.facts,experiences:profile.facts.experiences.map(e=>({...e,jobTitleId:related.id}))};
  const result=evaluateIntent({...profile.preferences,selectedIds:index.expandedIds},unrelatedExperience,{...job,experienceYearsMin:3},index,now);
  check(result.insights.evidence.find(e=>e.kind==='EXPERIENCE')?.status==='UNKNOWN','sibling profession experience is not counted as identical '+family);
}
const a=structuredClone(benchmarkRoles[0]),b=structuredClone(benchmarkRoles[1]),c=structuredClone(benchmarkRoles[2]);
a.matchingMetadata={relatedRoles:[{id:b.id,kind:'RELATED',approved:true,reference:'fixture:direct'}]};b.matchingMetadata={relatedRoles:[{id:c.id,kind:'RELATED',approved:true,reference:'fixture:direct'}]};
const nontransitive=new PositionGroupOccupationIndex([a,b,c],[],[{id:'g',nameEn:'A',members:[a.id]}],'r');
check(!nontransitive.eligibility(nontransitive.expandedIds,c.id).eligible,'related paths are never traversed transitively');
console.log(JSON.stringify({suite:'position-groups',checks,heads:heads.length,positions:roles.length,memberships:graph.memberships.length,engine:'employee-intent-v3.2'}));
