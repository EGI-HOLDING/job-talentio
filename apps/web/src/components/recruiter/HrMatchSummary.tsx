'use client';
import type { HrRankingMetadata, MatchEvidence } from '@job-talentio/shared';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import s from './HrMatchSummary.module.css';
export type HrAssessment=HrRankingMetadata&{evidence?:MatchEvidence[];sources?:Array<{ref:string;line:number;text:string;confirmed:boolean}>};
export function HrMatchSummary({assessment,detail=false}:{assessment?:Partial<HrAssessment>|null;detail?:boolean}){
  const {t,locale}=useI18n(),enumLabel=useEnumLabel();if(!assessment?.rankingVersion)return null;
  const state=assessment.state??'EVIDENCE_REVIEW_REQUIRED';
  const title=state==='READY'?t('hrV2.group.'+(assessment.requirementGroup??'UNASSESSABLE')):t('hrV2.state.'+state);
  const rows=detail?assessment.evidence??[]:assessment.reasons??[];
  if(detail) return <section className={s.detail} aria-label={t('hrV2.assessment')}><header><h3>{locale==='id'?'Kecocokan dengan persyaratan lowongan':t('hrV2.assessment')}</h3><strong className={s.group}>{title}</strong></header><p>{locale==='id'?'Informasi yang belum tercantum di CV perlu dikonfirmasi; ini tidak otomatis berarti kandidat tidak memiliki kemampuan tersebut.':t('ranking.limit')}</p><div className={s.requirements}>{(['ROLE','SKILL','EXPERIENCE','LANGUAGE'] as const).map(kind=>{const group=rows.filter(r=>r.kind===kind);return group.length>0&&<div className={s.requirementGroup} key={kind}><strong>{locale==='id'?{ROLE:'Jabatan',SKILL:'Keahlian',EXPERIENCE:'Pengalaman',LANGUAGE:'Bahasa'}[kind]:kind}</strong><ul>{group.map((row,i)=><li key={row.kind+row.label+i}><div><span>{row.kind==='EXPERIENCE'?/^\d+(\.\d+)?$/.test(row.label)?(locale==='id'?'Minimal ':'Minimum ')+row.label+' '+t('years'):enumLabel('experienceLevel',row.label):row.label}{row.minimumLevel?' · '+enumLabel('skillLevel',row.minimumLevel):''}</span>{row.evidenceRefs.map(ref=>{const source=assessment.sources?.find(v=>v.ref===ref);return source?<small key={ref}>{source.line>0?t('hrV2.line').replace('{n}',String(source.line))+': ':''}{source.text}</small>:null;})}</div><span className={s.status} data-status={row.status}>{row.status==='UNKNOWN'&&locale==='id'?(row.code==='LEVEL_UNCONFIRMED'?'Level belum dikonfirmasi':'Perlu konfirmasi'):t('hrV2.evidence.'+row.status)}</span></li>)}</ul></div>;})}</div><small>{t(assessment.source==='APPLICATION'?'hrV2.source.application':'hrV2.source.database')}</small></section>;
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
