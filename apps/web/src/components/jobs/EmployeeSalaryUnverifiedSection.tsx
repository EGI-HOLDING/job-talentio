'use client';
import { useEmployeeIntentText } from '@/lib/i18n/employeeIntent';
import { Link } from '@/lib/navigation';

/** Its count and pagination are separate from the main recommendations. */
export function EmployeeSalaryUnverifiedSection({total,scope="primary"}:{total:number;scope?:"primary"|"related"}) {
  const m=useEmployeeIntentText();
  if(!total)return null;
  return <section className="card" aria-label={m('salaryUnverifiedTitle')} style={{marginTop:16}}>
    <h3>{m('salaryUnverifiedTitle')} ({total})</h3>
    <p>{m('salaryUnverifiedCopy')}</p>
    <Link className="secondary" href={"/jobs?mode=salary-unverified"+(scope==="related"?"&scope=related":"")}>{m('salaryUnverifiedView')}</Link>
  </section>;
}
