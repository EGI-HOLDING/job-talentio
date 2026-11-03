import type { EmployeeEvaluation } from './employee-matching';
import type { IntentEvaluation } from './employee-intent';
export function publicEmployeeEvaluation(value:EmployeeEvaluation|IntentEvaluation|undefined){
 const eligibility=value&&'eligibility' in value?value.eligibility:undefined;
  return {recommendationType:eligibility?.matchType,matchScore:value?.insights.mode==='PREFERENCES_BASED'?null:value?.score??null,matchInsights:value?.insights,
  matchType:eligibility?.matchType,selectedRoleId:eligibility?.selectedRoleId,selectedRoleName:eligibility?.selectedRoleName,relationReference:eligibility?.relationReference};
}
