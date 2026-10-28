'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Link, useRouter } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { PackageCatalog, PackageCode, JobOrder, PurchaseIntent, commerceReturn, money, packageCode } from '@/lib/jobCommerce';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { PackagePricing } from './PackagePricing';
import s from './JobCommerce.module.css';

export function JobPackageSelection() {
  const {id} = useParams<{id: string}>(), params = useSearchParams(), router = useRouter(), {t, locale} = useI18n();
  const [data, setData] = useState<{job: any; benefit: any; catalog: PackageCatalog}|null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const keys = useRef<Record<string, string>>({});
  const returnTo = commerceReturn(params.get('returnTo'), id);
  const preferred = packageCode(params.get('package')), context = id + ':' + locale + ':' + returnTo + ':' + preferred;
  const currentContext = useRef(context), alive = useRef(true), submitting = useRef(false);
  currentContext.current = context;
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {
    const abort = new AbortController(); setError(''); setData(null); setBusy(false); submitting.current = false;
    Promise.all([api<any>('/jobs/' + id, {signal: abort.signal}), api<any>('/benefits/jobs/' + id, {signal: abort.signal}), api<PackageCatalog>('/job-commerce/catalog', {auth: false, signal: abort.signal})])
      .then(([job, benefit, catalog]) => {if (!abort.signal.aborted) setData({job, benefit, catalog});}).catch(e => {if (!abort.signal.aborted) setError(e.message);});
    return () => abort.abort();
  }, [id, locale, retry, context]);
  const expired = Boolean(data?.benefit.expiresAt && new Date(data.benefit.expiresAt) <= new Date());
  const intent: PurchaseIntent = expired ? 'RENEW' : data?.benefit.selected && (data.benefit.startsAt || data.benefit.code !== 'FREE') ? 'UPGRADE' : 'PURCHASE';
  const highest = intent === 'UPGRADE' && data?.benefit.code === 'PREMIUM';
  const codes: PackageCode[] = ['FREE', 'STANDARD', 'PREMIUM'];
  const disabled = intent === 'UPGRADE' ? codes.filter(code => codes.indexOf(code) <= codes.indexOf(data?.benefit.code)) : [];
  async function choose(code: PackageCode) {
    if (submitting.current || !data || data.job.id !== id) return; submitting.current = true; setBusy(true); setError('');
    const requestContext = context;
    const input = {jobId: id, code, intent}, identity = JSON.stringify(input);
    keys.current[identity] ||= crypto.randomUUID();
    try {
      const order = await api<JobOrder>('/job-commerce/orders', {method: 'POST', headers: {'Idempotency-Key': keys.current[identity]}, body: JSON.stringify(input)});
      if (!alive.current || currentContext.current !== requestContext) return;
      if (order.status === 'PAID') router.replace(returnTo);
      else router.push('/checkout/' + order.id + '?returnTo=' + encodeURIComponent(returnTo));
    } catch (e) {if (alive.current && currentContext.current === requestContext) {setError(e instanceof Error ? e.message : String(e)); setBusy(false); submitting.current = false;}}
  }
  if (!data || data.job.id !== id) return <div className={s.page + ' ' + s.workspace}>{error ? <div className={s.error} role="alert">{error}<br/><button className={s.text} onClick={() => setRetry(n => n + 1)}>{t('workspace.retry')}</button></div> : <WorkspaceLoading/>}</div>;
  return <div className={s.page + ' ' + s.workspace}><Link className={s.text} href={returnTo}>← {t('commerce.back')}</Link>
    <header className={s.intro}><span className={s.eyebrow}>{t('commerce.packageFor')}</span><h1>{t('commerce.' + (highest ? 'current' : intent === 'UPGRADE' ? 'upgrade' : intent === 'RENEW' ? 'renew' : 'pricing'))}</h1><p>{t('commerce.' + (highest ? 'highest' : intent === 'UPGRADE' ? 'upgradeHint' : intent === 'RENEW' ? 'renewalHint' : 'subtitle'))}</p></header>
    <div className={s.context}><div><strong>{data.job.title}</strong><p>{data.job.company?.name}</p></div>{data.benefit.selected && <span className={s.status}>{t('commerce.current')} | {t('commerce.' + data.benefit.code)}</span>}</div>
    {error && <div className={s.error} role="alert">{error}</div>}
    {intent === 'UPGRADE' && !highest && <p className={s.notice}>{data.catalog.packages.filter(p => !disabled.includes(p.code)).map(p => t('commerce.' + p.code) + ': ' + money(p.amount - (data.catalog.packages.find(item => item.code === data.benefit.code)?.amount || 0), locale)).join(' | ')}</p>}
    {preferred && !disabled.includes(preferred) && <p className={s.notice}>{t('commerce.preferredHint').replace('{package}', t('commerce.' + preferred))}</p>}
    <PackagePricing catalog={data.catalog} preferred={preferred && !disabled.includes(preferred) ? preferred : undefined} current={data.benefit.selected && !expired ? data.benefit.code : undefined} upgradeFrom={intent === 'UPGRADE' ? data.catalog.packages.find(p => p.code === data.benefit.code) : undefined} onChoose={choose} disabledCodes={disabled} busy={busy}/>
  </div>;
}
