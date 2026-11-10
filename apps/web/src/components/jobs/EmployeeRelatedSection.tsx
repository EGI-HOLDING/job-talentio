'use client';
import {Link} from '@/lib/navigation';
import {useI18n} from '@/lib/i18n';
import {useApiResource} from '@/lib/useApiResource';
import {EmployeeMatchReasons} from './EmployeeRecommendationState';
import type {MatchInsights} from '@job-talentio/shared';

export function EmployeeRelatedSection({total,salaryUnverifiedTotal=0,preview=false}:{total:number;salaryUnverifiedTotal?:number;preview?:boolean}){
  const {locale}=useI18n(),id=locale==='id';
  const resource=useApiResource<{items:Array<{job:{id:string;title:string;company:{name:string}};matchInsights?:MatchInsights}>}>(preview&&total>0?'/jobs/recommended?page=1&limit=3&feed=related&presentation=separated':null);
  if(!total&&!salaryUnverifiedTotal)return null;
  return <section className="card" style={{marginTop:16}} aria-label={id?'Profesi terkait':'Related occupations'}>
    <h3>{id?'Profesi terkait':'Related occupations'} ({total})</h3>
    <p>{id?'Pilihan di luar posisi atau kelompok pilihan Anda yang memiliki tugas pekerjaan terkait.':'Other positions with related work tasks, outside your directly selected positions or groups.'}</p>
    {preview&&resource.data?.items.map(item=><article key={item.job.id} style={{padding:'12px 0',borderBottom:'1px solid #ece9f5'}}><Link href={'/jobs/'+item.job.id}><strong>{item.job.title}</strong></Link><p>{item.job.company.name}</p><EmployeeMatchReasons insights={item.matchInsights}/></article>)}
    {total>0&&<Link className="secondary" href="/jobs?mode=related">{id?'Lihat profesi terkait':'View related occupations'}</Link>}
    {salaryUnverifiedTotal>0&&<p><Link href="/jobs?mode=salary-unverified&scope=related">{id?'Profesi terkait, gaji belum dapat dipastikan':'Related occupations, salary unconfirmed'} ({salaryUnverifiedTotal})</Link></p>}
  </section>;
}
