export const EMPLOYEE_EXPERIENCE_POLICY_VERSION = 'employee-experience-v2';
// Explicit activation, separate from HR and employee occupation selection.
export const employeeExperiencePolicyEnabled=()=>true;
export const employeeExperienceRevision=()=>EMPLOYEE_EXPERIENCE_POLICY_VERSION;
export const candidateExperienceSelect={seniorityLevelCode:true,seniorityVersion:true,seniorityYearsMin:true,seniorityYearsMax:true,experienceRangeMin:true,experienceRangeMax:true,experienceRangeSource:true} as const;
export type CandidateExperienceInput={experienceYearsMin:number|null;seniorityLevelCode?:string|null;seniorityVersion?:string|null;seniorityYearsMin?:number|null;seniorityYearsMax?:number|null;experienceRangeMin?:number|null;experienceRangeMax?:number|null;experienceRangeSource?:string|null};
const employerReference=(minimum:number|null)=>Object.freeze({source:'EMPLOYER_REQUIREMENT' as const,minimum,maximum:null,version:null,levelCode:null,required:true});
const employerReferences=Array.from({length:51},(_,minimum)=>employerReference(minimum));
const noEmployerReference=employerReference(null);
export function candidateExperienceReference(job: CandidateExperienceInput, enabled = employeeExperiencePolicyEnabled()) {
  if(enabled&&job.seniorityLevelCode&&job.seniorityVersion&&job.experienceRangeMin!=null&&job.experienceRangeSource){
    return {source:job.experienceRangeSource==='EMPLOYER_ADJUSTED'?'EMPLOYER_ADJUSTED' as const:'CATALOG_DERIVED' as const,minimum:job.experienceRangeMin,maximum:job.experienceRangeMax??null,version:job.seniorityVersion,levelCode:job.seniorityLevelCode,required:false};
  }
  const { seniorityYearsMin: minimum, seniorityYearsMax: maximum } = job;
  const validRange = minimum != null && Number.isInteger(minimum) && minimum >= 0
    && (maximum === null || maximum != null && Number.isInteger(maximum) && maximum >= minimum);
  if (enabled && job.seniorityLevelCode && job.seniorityVersion && validRange) {
    return { source: 'CATALOG_DERIVED' as const, minimum: minimum!, maximum: maximum ?? null,
      version: job.seniorityVersion, levelCode: job.seniorityLevelCode, required: false };
  }
  const legacyMinimum = job.experienceYearsMin;
  return legacyMinimum === null ? noEmployerReference : employerReferences[legacyMinimum] ?? employerReference(legacyMinimum);
}
