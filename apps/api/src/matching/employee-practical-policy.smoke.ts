import assert from 'node:assert/strict';
import { practicalFit } from './employee-practical-policy';
import { makeEmployeeBenchmark, benchmarkRank } from './employee-intent.benchmark';
import type { IntentPreferences } from './employee-intent';

const preferences:IntentPreferences={selectedIds:[],preferredCountries:[{id:'destination'}],residenceCountryId:'home',preferredWorkModes:[],desiredSalaryMin:'257.50',desiredSalaryCurrency:'IDR',desiredSalaryPeriod:'MONTHLY'};
const job={countryId:'destination',city:null,salaryMin:200,salaryMax:300,currency:'IDR',salaryPeriod:'MONTHLY'};
let checks=0;
const check=(actual:unknown,expected:unknown)=>{assert.deepEqual(actual,expected);checks++;};
const fit=(p={},j={})=>practicalFit({...preferences,...p},{...job,...j});
check(fit().group,'MAIN');check(fit().salaryReason,'UPPER_BOUND_MEETS');
check(fit({}, {salaryMin:258}).salaryReason,'ENTIRE_RANGE_MEETS');
check(fit({}, {salaryMax:257}).salary,'UNMET');
check(fit({}, {salaryMax:258}).salary,'MET');
check(fit({}, {salaryMin:null,salaryMax:258}).salaryReason,'UPPER_BOUND_MEETS');
check(fit({}, {salaryMin:258,salaryMax:null}).salary,'MET');
check(fit({}, {salaryMax:null}).group,'SALARY_UNVERIFIED');
check(fit({}, {salaryMin:null,salaryMax:null}).salaryReason,'NOT_DISCLOSED');
check(fit({}, {salaryMin:400,salaryMax:300}).salaryReason,'INVALID_RANGE');
check(fit({}, {salaryMax:-1}).salaryReason,'INVALID_RANGE');
check(fit({}, {currency:'USD'}).group,'SALARY_UNVERIFIED');
check(fit({}, {currency:'idr'}).salary,'MET');
check(fit({}, {salaryMin:null,salaryMax:3090,salaryPeriod:'YEARLY'}).salary,'MET');
check(fit({}, {salaryMin:null,salaryMax:3089,salaryPeriod:'YEARLY'}).salary,'UNMET');
check(fit({desiredSalaryMin:3090,desiredSalaryPeriod:'YEARLY'}, {salaryMax:258}).salary,'MET');
check(fit({}, {salaryPeriod:'HOURLY'}).salaryReason,'PERIOD_MISMATCH');
check(fit({desiredSalaryPeriod:'HOURLY'}, {salaryPeriod:'HOURLY'}).salary,'MET');
for(const desiredSalaryMin of [null,0])check(fit({desiredSalaryMin}, {salaryMin:null,salaryMax:null}).salary,'NOT_REQUESTED');
check(fit({}, {countryId:'home'}).group,'EXCLUDED');
check(fit({preferredCountries:[]}, {countryId:'home'}).country,'MET');
check(fit({preferredCountries:[{id:'destination'},{id:'home'}]}, {countryId:'home'}).country,'MET');
check(fit({}, {countryId:null,city:{province:{countryId:'destination'}}}).country,'MET');
check(fit({}, {city:{province:{countryId:'home'}}}).country,'UNKNOWN');
check(fit({}, {countryId:null}).group,'EXCLUDED');
check(fit({preferredCountries:[],residenceCountryId:null}, {countryId:null}).country,'NOT_REQUESTED');
check(practicalFit(preferences,{...job,countryId:'elsewhere',salaryMax:1,salaryMin:null},false).group,'MAIN');
// All benchmark families use the same policy; filtering cannot change relative rank.
const data=makeEmployeeBenchmark();
for(const profile of data.profiles){
  const baseline=benchmarkRank(profile.preferences,profile.facts,data.jobs);
  const p={...profile.preferences,preferredCountries:[],residenceCountryId:null,desiredSalaryMin:null};
  check(baseline.filter(id=>practicalFit(p,data.jobs.find(j=>j.id===id)!).group==='MAIN'),baseline);
}
console.log(`Practical policy: ${checks} checks passed, including baseline order for 60 profiles / 10 families`);
