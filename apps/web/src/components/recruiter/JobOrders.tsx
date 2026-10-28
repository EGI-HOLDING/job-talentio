'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Link, useRouter } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { JobOrder, money, packageHref } from '@/lib/jobCommerce';
import { employerWorkspaceHref } from '@/lib/accountNavigation';
import { Pagination, WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { JobBenefits } from './HrBenefits';
import s from './JobCommerce.module.css';

export function JobOrders() {
  const {t, locale} = useI18n(), router = useRouter(), params = useSearchParams();
  const [memberships, setMemberships] = useState<any[]|null>(null), [companyId, setCompanyId] = useState(params.get('company') || ''), [orders, setOrders] = useState<JobOrder[]|null>(null), [jobs, setJobs] = useState<any[]>([]), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [page,setPage]=useState(1),[total,setTotal]=useState(0);
  const requestedCompany=params.get('company');
  useEffect(()=>{if(requestedCompany&&memberships?.some(row=>row.companyId===requestedCompany))setCompanyId(requestedCompany);},[requestedCompany,memberships]);
  useEffect(()=>{setPage(1);},[companyId]);
  useEffect(() => {
    const abort = new AbortController(); setError('');
    api<any[]>('/companies/mine', {signal: abort.signal}).then(values => {setMemberships(values); setCompanyId(current => values.some(row => row.companyId === current) ? current : values[0]?.companyId || '');}).catch(e => {if (!abort.signal.aborted) setError(e.message);});
    return () => abort.abort();
  }, [retry]);
  useEffect(() => {
    if (!companyId) return; const abort = new AbortController(); setError(''); setOrders(null); setJobs([]);
    Promise.all([api<{items:JobOrder[];total:number}>('/job-commerce/orders/history?companyId=' + encodeURIComponent(companyId)+'&page='+page, {signal: abort.signal}), api<any[]>('/jobs/company/' + encodeURIComponent(companyId), {signal: abort.signal})])
      .then(([history, postings]) => {if (!abort.signal.aborted) {setOrders(history.items); setTotal(history.total); setJobs(postings);}}).catch(e => {if (!abort.signal.aborted) setError(e.message);});
    return () => abort.abort();
  }, [companyId, locale, retry,page]);
  return <div className={s.page + ' ' + s.workspace}><Link className={s.text} href={employerWorkspaceHref('jobs', companyId)}>← {t('commerce.back')}</Link><header className={s.headline}><span className={s.eyebrow}>Talentio · HR</span><h1>{t('commerce.orders')}</h1><p>{t('commerce.ordersHint')}</p></header>
    {error && <div className={s.error} role="alert">{error}<br/><button className={s.text} onClick={() => setRetry(n => n + 1)}>{t('workspace.retry')}</button></div>}
    {memberships && memberships.length > 1 && <select className={s.companySelect} aria-label={t('companyName')} value={companyId} onChange={event => {setCompanyId(event.target.value); router.replace('/dashboard/recruiter/orders?company=' + encodeURIComponent(event.target.value));}}>{memberships.map(row => <option key={row.companyId} value={row.companyId}>{row.company.name}</option>)}</select>}
    {!memberships || (!orders && companyId && !error) ? <WorkspaceLoading/> : <>
      {!companyId && <p>{t('rw.noCompanyHint')}</p>}
      <div className={s.orders}>{jobs.map(job => <article className={s.order} key={job.id}><div><h2>{job.title}</h2><JobBenefits jobId={job.id} status={job.status}/></div><Link className={s.secondary} href={packageHref(job.id)}>{t('commerce.pricing')} →</Link></article>)}</div>
      <h2 style={{fontSize: '1.1rem', margin: '36px 0 20px'}}>{t('commerce.orderHistory')}</h2>
      {!orders?.length ? <p className={s.notice}>{t('commerce.noOrders')}</p> : <div className={s.orders}>{orders.map(order => <article className={s.order} key={order.id}><div><h2>{order.jobTitle}</h2><p>{t('commerce.' + order.code)} · {money(order.amount, locale, order.currency)}<br/>{new Date(order.createdAt).toLocaleDateString(locale)}{order.provider === 'local-test' && ' · ' + t('commerce.testMode')}</p></div><span className={s.status} data-status={order.status}>{t('commerce.' + order.status)}</span><Link className={s.text} href={'/checkout/' + order.id}>{t('commerce.continue')} →</Link></article>)}</div>}
      {total>20&&<Pagination page={page} total={total} size={20} onChange={setPage}/>}
    </>}
  </div>;
}
