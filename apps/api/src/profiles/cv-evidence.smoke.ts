import assert from 'node:assert/strict';
import { cvFacts, withCvFacts } from './cv-evidence';
import { OccupationIndex } from '../matching/employee-matching';
import { evaluateRecruiter } from '../matching/recruiter-matching';
import { safeApplication } from '../applications/application-payload';

const skill={id:'react',name:'React',slug:'react',normalizedKey:'react',aliases:[{aliasKey:'reactjs'}]};
const parsed={headline:'Frontend Developer',textPreview:'CV fixture',skillNames:['React.js'],experiences:[
  {title:'Frontend Developer',companyName:'A',startDate:'2020-01-01',endDate:'2022-01-01'},
  {title:'Frontend Developer',companyName:'B',startDate:'2021-01-01',endDate:'2023-01-01'},
  {title:'Frontend Developer',companyName:'Undated'},
],educations:[],languages:[]};
const data=cvFacts(parsed,[skill],'v1',new Date('2025-01-01'));
assert.equal(data.skillIds.length,1);assert.ok(Math.abs(data.experienceYears!-3)<0.01,'overlapping work must not double count');
assert.equal((data.matchingData as any).experiences.length,2,'undated experience must not fabricate years');
const base={id:'p',headline:'Backend Developer',desiredPositions:[],skills:[{skillId:'old',level:'EXPERT',skill:{id:'old',name:'Old',slug:'old'}}],experiences:[],languages:[]};
const source=withCvFacts(base,{id:'v1',parseStatus:'READY',matchingData:data.matchingData});
assert.deepEqual(source.skills.map(s=>s.skillId),['react'],'CV facts replace the professional source, rather than merging');
assert.equal(source.skills[0].levelSource,'CV_UNCONFIRMED');
const index=new OccupationIndex([{id:'fe',name:'Frontend Developer',normalizedKey:'frontenddeveloper',aliases:[]}]);
const job={id:'j',companyId:'c',title:'Frontend Developer',jobTitleId:'fe',workMode:'REMOTE',jobSkills:[{skillId:'react',skill,isRequired:true,weight:1,minLevel:'EXPERT'}],jobLanguages:[]};
const pending=withCvFacts(base,{id:'new',parseStatus:'PENDING',matchingData:null});
assert.equal(pending.skills.length,0);assert.equal(pending.headline,null);
assert.equal(evaluateRecruiter(pending,job,index).assessable,false);
assert.equal(withCvFacts(base,null).experiences.length,0);
const preferenceOnly=withCvFacts({...base,desiredPosition:'Frontend Developer',desiredPositions:['Frontend Developer']},{id:'empty',parseStatus:'READY',matchingData:{headline:null,skills:[],experiences:[],educations:[]}});
assert.equal(evaluateRecruiter(preferenceOnly,job,index).positiveCore,false,'HR scores must not turn a desired occupation into CV evidence');
const undated=cvFacts({...parsed,headline:undefined,skillNames:[],experiences:[{title:'Frontend Developer',companyName:'A'}]},[],'undated');
const undatedProfile=withCvFacts(base,{id:'undated',parseStatus:'READY',matchingData:undated.matchingData});
assert.equal(undated.experienceYears,null);
const safe=safeApplication({resumeSnapshot:{cvEvidence:data.matchingData,cvSupplement:{languages:['private']},resume:{fileKey:'private/key.pdf',fileUrl:'private/url',title:'CV'}}});
assert.ok(!JSON.stringify(safe).includes('cvEvidence'));assert.ok(!JSON.stringify(safe).includes('private'));
console.log('CV evidence: source isolation, duration union, unknown proficiency, pending state and payload privacy passed');
