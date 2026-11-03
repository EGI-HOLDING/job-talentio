import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planCatalogRepair } from './employee-catalog-repair';
import { planCandidatePreferences, planJobOccupationLinks } from './employee-catalog-repair-links';
import { EmployeeOccupationIndex, employeeOccupationRevision, type IntentRole } from './employee-occupation';
import { employeeEvidenceParserVersion } from './employee-intent-evidence';
const data=(name:string)=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../prisma/data',name),'utf8').replace(/^\uFEFF/,''));
const official=data('job-titles/audit-2026-10-24.json').rows;
const families=data('employee-job-families.json').rows.map((f:any)=>({id:'isco:'+f.code,archivedAt:null,name:f.name}));
const roles:IntentRole[]=official.map((r:any)=>({id:r.targetId,name:r.name,nameId:r.nameId,nameUz:r.nameUz,nameRu:r.nameRu,familyId:r.source?.isco08?'isco:'+r.source.isco08.slice(0,3):null,family:r.source?.isco08?families.find((f:any)=>f.id==='isco:'+r.source.isco08.slice(0,3)):null,canonicalRoleId:null,matchingApproved:!!r.source?.isco08,archivedAt:null,aliases:(r.aliases||[]).map((alias:string)=>({alias,matchingApproved:false}))}));
let passed=0;
function check(value:unknown,message:string){assert.ok(value,message);passed++;}
// Reproduce accepted historical label changes while retaining stable IDs.
for(const [original,current] of [['Data Entry Clerk','Data Clerk'],['Data Entry Supervisor','Data Supervisor'],['Further Education Principal','Further Education'],['Middle Office Analyst','Office Analyst']]){
 const r=roles.find(r=>r.name===original)!;r.name=current;r.familyId=null;r.family=null;r.matchingApproved=false;
}
const mobile=roles.find(r=>r.name==='Mobile Application Developer')!;
roles.push({...mobile,id:'archived-mobile-duplicate',archivedAt:new Date(),matchingApproved:false});
roles.push({id:'smoke-occupation',name:'Guarded Workspace Test',familyId:null,canonicalRoleId:null,matchingApproved:false,aliases:[]});
const plan=planCatalogRepair({roles,families,official});
assert.deepEqual(plan.errors,[]);passed++;
assert.deepEqual(plan.unknown,[]);passed++;
check(plan.pending.some(r=>r.id==='smoke-occupation'),'exact known test occupation quarantined');
check(plan.index.resolve('Mobile Application Developer')===mobile.id,'archived duplicate cannot block an active occupation');
check(plan.index.resolve('Data Entry Clerk')===official.find((r:any)=>r.name==='Data Entry Clerk').targetId,'renamed official role keeps its historical ID');
const titleFixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,'fixtures/indonesia-vacancy-titles.json'),'utf8'));
check(titleFixture.titles.length===240,'replay all 240 missing-ID titles from the Indonesia audit');
const jobs=titleFixture.titles.map((title:string,i:number)=>({id:'replay-'+i,title,jobTitleId:null}));
const links=planJobOccupationLinks(jobs,plan.index);
assert.deepEqual(links.unresolved,[]);passed++;
check(links.updates.length===240&&links.updates.every(j=>plan.index.identity(j.jobTitleId)),'every audited vacancy gets a valid occupation identity and family');
const ids=['Backend Developer','Frontend Developer','Full-stack Developer','Accountant','Mechanical Engineer'].map(name=>plan.index.resolve(name)!);
check(ids.every(Boolean),'five professions resolve');
const selected=ids.map(id=>plan.index.identity(id)!);
for(const r of plan.roles){
 const expected=selected.some(s=>s.canonicalRoleId===plan.index.identity(r.id)?.canonicalRoleId&&s.familyId===plan.index.identity(r.id)?.familyId);
 check(plan.index.eligibility(ids,r.id).eligible===expected,'five choices never form cross-role/family combinations');
}
check(plan.index.resolve('Back End Developer')===ids[0],'reviewed spelling variant has equal identity');
const accountant=plan.index.resolve('Accountant')!;
check(plan.index.resolve('Akuntan')===accountant,'official translation retains identity');
check(plan.index.resolve('Accounting Staff')!==accountant,'Accounting Staff is a separate occupation');
check(plan.index.resolve('Staf akuntansi')===plan.index.resolve('Accounting Staff'),'staff translation resolves to staff instead of Accountant');
for(const title of ['Accounting Staff','Auditor','Tax Staff'])check(!plan.index.eligibility([accountant],plan.index.resolve(title)).eligible,'Accountant excludes '+title);
check(!plan.index.resolve('Backend Sales Developer'),'text similarity never establishes equivalence');
const profile={id:'five-choices',desiredPositions:['Backend Developer','Frontend Developer','Full-stack Developer','Accountant','Mechanical Engineer'],desiredPosition:'Backend Developer',matchingPreferencesReviewed:false,desiredRoles:[]};
const prefs=planCandidatePreferences([profile],plan.index);
check(prefs.updates[0].ids.length===5,'all five choices migrate together');
check(new Set(prefs.updates[0].ids).size===5,'no choice is duplicated or dropped');
const ambiguous={...profile,id:'unresolved',desiredPositions:['Backend Developer','Unspecified role']};
const unchanged=JSON.stringify(ambiguous);
check(planCandidatePreferences([ambiguous],plan.index).updates.length===0,'unresolved choice never produces a partial silent migration');
check(JSON.stringify(ambiguous)===unchanged,'original preferences preserved');
const again=planCatalogRepair({roles:plan.roles,families,official});
check(!again.creates.length&&!again.updates.length&&!again.errors.length,'catalog application is idempotent');
const reversed=[...plan.roles].reverse().map(r=>({...r,aliases:[...r.aliases].reverse()}));
check(employeeOccupationRevision(reversed)===employeeOccupationRevision(plan.roles),'catalog revision independent of database/alias ordering');
const modified=structuredClone(plan.roles);modified.find(r=>r.id===ids[0])!.matchingApproved=false;
check(employeeEvidenceParserVersion(modified)!==employeeEvidenceParserVersion(plan.roles),'catalog mapping changes invalidate CV evidence');
const conflict=structuredClone(roles);conflict.push({...mobile,id:'active-mobile-duplicate'});
check(planCatalogRepair({roles:conflict,families,official}).errors.length>0,'active conflicting identities fail closed');
console.log(JSON.stringify({suite:'global-occupation-repair',passed,sourceTitles:official.length,replayedIndonesiaVacancies:240,unmapped:plan.unknown.length,zeroLeakage:true}));
