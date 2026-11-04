'use client';
import { useEmployeeIntentText } from '@/lib/i18n/employeeIntent';
import { Link } from '@/lib/navigation';

/** Its count and pagination are separate from the main recommendations. */
export function EmployeeSalaryUnverifiedSection({total}:{total:number}) {
  const m=useEmployeeIntentText();
  if(!total)return null;
  return <section className="card" aria-label={m('salaryUnverifiedTitle')} style={{marginTop:16}}>
    <h3>{m('salaryUnverifiedTitle')} ({total})</h3>
    <p>{m('salaryUnverifiedCopy')}</p>
    <Link className="secondary" href="/jobs?mode=salary-unverified">{m('salaryUnverifiedView')}</Link>
  </section>;
}
