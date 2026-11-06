'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useI18n } from '@/lib/i18n';
import { UgcText } from '@/components/ui/UgcText';
export type StructuredJobFields={responsibilities?:string[];kpis?:string[];specificExpectations?:string|null;locale?:string;seniorityLevelCode?:string|null;seniorityYearsMin?:number|null;seniorityYearsMax?:number|null;experienceRangeMin?:number|null;experienceRangeMax?:number|null;experienceRangeSource?:string|null};
export function StructuredJobContent({job,className}:{job:StructuredJobFields;className?:string}){
  const c=useHrCopy();
  const {locale}=useI18n();const labels=locale==='id'?[c("Tanggung jawab utama"),c("KPI posisi"),c("Harapan spesifik posisi | Nilai tambah")]:['Responsibilities',c("Role KPIs"),c("Specific expectations | Nice-to-have")];
  return <>{[job.responsibilities??[],job.kpis??[]].map((rows,index)=>rows.length>0&&<section className={className} key={labels[index]}><h3>{labels[index]}</h3><ul>{rows.map((text,i)=><li key={i}><UgcText text={text} contentLocale={job.locale}/></li>)}</ul></section>)}{job.specificExpectations&&<section className={className}><h3>{labels[2]}</h3><UgcText text={job.specificExpectations} contentLocale={job.locale} preserveLineBreaks/></section>}</>;
}
export function jobExperienceLabel(job:StructuredJobFields){
  const minimum=job.experienceRangeSource?job.experienceRangeMin:job.seniorityYearsMin;
  const maximum=job.experienceRangeSource?job.experienceRangeMax:job.seniorityYearsMax;
  return job.seniorityLevelCode&&minimum!=null?maximum==null?`${minimum}+`:`${minimum}-${maximum}`:null;
}
