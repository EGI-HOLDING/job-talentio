import assert from 'node:assert/strict';
import { EmployeeOccupationIndex, type IntentRole } from './employee-occupation';
import { HR_VERSION, evaluateHr, compareHr, parseHrEvidence, emptyHrFacts, type HrCatalog, type HrFacts, type HrProfile } from './recruiter-ranking';
import { freezeHrSubmission, hrApplicationProfile } from './recruiter-evidence';
const family={id:'f',name:'Accountants',archivedAt:null};
const role=(id:string,name:string,canonicalRoleId:string|null=null):IntentRole=>({id,name,familyId:'f',family,canonicalRoleId,matchingApproved:true,archivedAt:null,aliases:[]});
const roles=[role('a','Accountant'),role('ak','Akuntan','a'),role('staff','Accounting Staff'),role('tax','Tax Staff'),role('sales','Sales')];
const skill={id:'ledger',name:'Ledger',nameId:'Buku Besar',slug:'ledger',matchingKind:'PROFESSIONAL',aliases:[{alias:'General ledger'}]};
const c:HrCatalog={roles,skills:[skill],languages:[],revision:'test',index:new EmployeeOccupationIndex(roles)};
const job:any={id:'j',companyId:'c',title:'Accountant',jobTitleId:'a',workMode:'ONSITE',jobSkills:[{skillId:'ledger',skill,isRequired:true,weight:1,minLevel:'ADVANCED'}],jobLanguages:[]};
const now=new Date('2026-11-03T00:00:00Z');
const facts=():HrFacts=>({...emptyHrFacts(),skills:[{key:'s',skillId:'ledger',level:null,confirmed:false,source:'CV'}]});
const p=(f=facts()):HrProfile=>({id:'p',skills:[],experiences:[],languages:[],hr:{facts:f,state:'READY',asOf:'2026-01-01T00:00:00Z',source:'APPLICATION',revision:'r'}});
let count=0;function check(v:unknown,label:string){assert.ok(v,label);count++;}
const unknown=evaluateHr(p(),job,c,now);
check(unknown.version===HR_VERSION&&unknown.requirementGroup==='INCOMPLETE','unconfirmed level is incomplete');
check(unknown.skills>50&&unknown.evidence.find(e=>e.kind==='SKILL')?.status==='UNKNOWN','listed skill receives presence credit without a confirmed level');
const unmetFacts=facts();unmetFacts.skills[0]={...unmetFacts.skills[0],level:'BEGINNER',confirmed:true};
const unmet=evaluateHr(p(unmetFacts),job,c,now);
check(unmet.requirementGroup==='UNMET'&&compareHr(unknown,unmet)<0,'unknown precedes known shortfall');
const goodFacts=facts();goodFacts.skills[0]={...goodFacts.skills[0],level:'EXPERT',confirmed:true};
const good=evaluateHr(p(goodFacts),job,c,now);
check(good.requirementGroup==='MET'&&compareHr(good,unknown)<0,'all required criteria met first');
const unrelated={...goodFacts,roles:[{key:'role',jobTitleId:'sales',title:'Sales',source:'CV' as const,confirmed:false}]};
const exact={...unmetFacts,roles:[{key:'role',jobTitleId:'a',title:'Accountant',source:'CV' as const,confirmed:false}]};
check(compareHr(evaluateHr(p(unrelated),job,c,now),evaluateHr(p(exact),job,c,now))<0,'competence beats matching headline');
for(const id of ['a','ak']){const f={...goodFacts,roles:[{key:'role',jobTitleId:id,title:id,source:'CV' as const,confirmed:false}]};check(evaluateHr(p(f),job,c,now).roleFit===1,'canonical synonym '+id);}
for(const id of ['staff','tax']){const f={...goodFacts,roles:[{key:'role',jobTitleId:id,title:id,source:'CV' as const,confirmed:false}]};check(evaluateHr(p(f),job,c,now).roleFit===0,'separate occupation '+id);}
const e={key:'exp',title:'Akuntan',jobTitleId:'ak',startDate:'2020-01-01',endDate:null,isCurrent:true,seniority:null,source:'CV' as const,confirmed:false};
const career={...goodFacts,experiences:[e,{...e,key:'duplicate'}]};
const exp=evaluateHr(p(career),{...job,experienceYearsMin:10},c,now);
check(exp.details.experienceYears>5.99&&exp.details.experienceYears<6.01,'union capped at submission date');
check(exp.evidence.find(v=>v.kind==='EXPERIENCE')?.status==='UNKNOWN','partial work history not claimed inadequate');
check(evaluateHr(p(career),job,c,new Date('2030-01-01')).details.experienceYears===exp.details.experienceYears,'old CV never grows experience');
for(const attrs of [{fullName:'Changed',gender:'FEMALE',birthDate:'1960-01-01',nationality:'x',avatarUrl:'x'},{cityId:'a',residenceCountryId:'b',preferredCountries:[{id:'z'}]},{headline:'Accountant',desiredPosition:'Accountant'}]){
  check(compareHr(good,evaluateHr({...p(goodFacts),...attrs},job,c,now))===0,'personal fields and preferences neutral');
}
check(evaluateHr(p(goodFacts),{...job,jobSkills:[]},c,now).state==='JOB_REQUIREMENTS_REQUIRED','title-only posting never claims rank');
check(evaluateHr(p(emptyHrFacts()),job,c,now).state==='EVIDENCE_REVIEW_REQUIRED','blank evidence not neutral-score candidate');
for(const state of ['CV_REQUIRED','CV_PROCESSING','CV_FAILED','CV_UNAVAILABLE'] as const){const profile=p();profile.hr!.state=state;check(evaluateHr(profile,job,c,now).state===state&&!evaluateHr(profile,job,c,now).assessable,'unavailable state '+state);}
const many=Array.from({length:70},(_,i)=>({...skill,id:'s'+i,name:'Competency '+i,nameId:null,aliases:[],slug:'s'+i}));
const manyC={...c,skills:many};
const parsed=parseHrEvidence('Candidate\nAccountant\nSkills\n'+many.map(s=>s.name).join('\n'),manyC);
check(parsed.skills.length===70,'full catalog without 40-skill limit');
for(const text of ['Belum menguasai Ledger','Want to learn Ledger','No Ledger experience','Interested in Ledger'])check(parseHrEvidence(text,c).skills.length===0,'negated or aspirational claim '+text);
for(const text of ['Skills\nLedger','Keahlian\nBuku Besar','Experience\nUsed General ledger'])check(parseHrEvidence(text,c).skills.length===1,'language and layout skill parity');
const snapshot=freezeHrSubmission({id:'v',fileKey:'cv.pdf',parseGeneration:1,matchingData:null,employeeEvidence:{status:'READY',generation:1,revision:2,facts:goodFacts,overrides:[{kind:'SKILL',key:'s',value:goodFacts.skills[0]}]}},{languages:[]},new Date('2026-01-01'));
goodFacts.skills[0].level='BEGINNER';
check(snapshot.facts?.skills[0].level==='EXPERT','submission deep copies corrections');
const projected=hrApplicationProfile({id:'p'},snapshot,{id:'v',fileKey:'cv.pdf',parseGeneration:1},{status:'READY',generation:1,revision:1,checksum:null,facts:facts()},c);
check(projected.hr!.asOf==='2026-01-01T00:00:00.000Z','submission timestamp fixed');
check(hrApplicationProfile({id:'p'},snapshot,{id:'other',fileKey:'new.pdf',parseGeneration:1},null,c).hr!.state==='CV_UNAVAILABLE','no CV replacement fallback');
check(hrApplicationProfile({id:'p'},snapshot,{id:'v',fileKey:'cv.pdf',parseGeneration:2},{status:'READY',generation:1,revision:1,checksum:null,facts:facts()},c).hr!.state==='CV_PROCESSING','stale generation rejected');
check(compareHr(good,{...good,evidenceCoverage:0})===0,'coverage not a hidden ranking bonus');
console.log(JSON.stringify({suite:'hr-evidence-v2',passed:count,humanValidated:false}));
