'use client';
import type { HrRankingMetadata, MatchEvidence } from '@job-talentio/shared';
import { useI18n } from '@/lib/i18n';
import s from './HrMatchSummary.module.css';
export type HrAssessment=HrRankingMetadata&{evidence?:MatchEvidence[];sources?:Array<{ref:string;line:number;text:string;confirmed:boolean}>};
export function HrMatchSummary({assessment,detail=false}:{assessment?:Partial<HrAssessment>|null;detail?:boolean}){
  const {t}=useI18n();if(!assessment?.rankingVersion)return null;
  const state=assessment.state??'EVIDENCE_REVIEW_REQUIRED';
  const title=state==='READY'?t('hrV2.group.'+(assessment.requirementGroup??'UNASSESSABLE')):t('hrV2.state.'+state);
  const rows=detail?assessment.evidence??[]:assessment.reasons??[];
  return <section className={s.summary} data-state={state} aria-label={t('hrV2.assessment')}>
    <strong className={s.group}>{title}</strong>
    {rows.length>0&&<ul>{rows.map((row,i)=><li key={row.kind+row.label+i}>
      <span className={s.status} data-status={row.status}>{t('hrV2.evidence.'+row.status)}</span>{' '}
      <span>{row.label}{row.minimumLevel?' · '+row.minimumLevel:''}</span>
      {detail&&row.evidenceRefs.map(ref=>{const source=assessment.sources?.find(v=>v.ref===ref);return source?<small key={ref}>{source.confirmed?t('hrV2.confirmed')+' · ':''}{source.line>0?t('hrV2.line').replace('{n}',String(source.line))+': ':''}{source.text}</small>:null;})}
    </li>)}</ul>}
    {detail&&<small>{t(assessment.source==='APPLICATION'?'hrV2.source.application':'hrV2.source.database')} · {assessment.rankingVersion}</small>}
  </section>;
}
