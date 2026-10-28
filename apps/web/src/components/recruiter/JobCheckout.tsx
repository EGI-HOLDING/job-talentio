'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Link, useRouter } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { commerceReturn, JobOrder, PackageCatalog, money, packageHref } from '@/lib/jobCommerce';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import s from './JobCommerce.module.css';

export function JobCheckout() {
  const {orderId} = useParams<{orderId: string}>(), params = useSearchParams(), router = useRouter(), {t, locale} = useI18n();
  const currentOrder = useRef(orderId); currentOrder.current = orderId;
  const [order, setOrder] = useState<JobOrder|null>(null), [catalog, setCatalog] = useState<PackageCatalog|null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError(''); setOrder(null); setCatalog(null); setBusy(false);
    Promise.all([api<JobOrder>('/job-commerce/orders/' + orderId, {signal: abort.signal}), api<PackageCatalog>('/job-commerce/catalog', {auth: false, signal: abort.signal})])
      .then(([value, packages]) => {if (!abort.signal.aborted) {setOrder(value); setCatalog(packages);}}).catch(e => {if (!abort.signal.aborted) setError(e.message);});
    return () => abort.abort();
  }, [orderId, retry]);
  useEffect(() => {
    if (order?.id !== orderId || order.status !== 'PENDING') return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let pending = true;
      try {
        const value = await api<JobOrder>('/job-commerce/orders/' + orderId, {signal: abort.signal});
        if (!abort.signal.aborted) {setOrder(value); pending = value.status === 'PENDING';}
      } catch { /* A temporary outage must not stop payment confirmation polling. */ }
      if (!abort.signal.aborted && pending) timer = setTimeout(() => void poll(), 5000);
    };
    timer = setTimeout(() => void poll(), 5000);
    return () => {clearTimeout(timer); abort.abort();};
  }, [order?.id, order?.status, orderId]);
  if (!order || order.id !== orderId || !catalog) return <div className={s.page}>{error ? <div className={s.error} role="alert">{error}<br/><button className={s.text} onClick={() => setRetry(n => n + 1)}>{t('workspace.retry')}</button></div> : <WorkspaceLoading/>}</div>;
  const returnTo = commerceReturn(params.get('returnTo'), order.jobId);
  async function pay() {
    if (busy || !order) return; const requestedOrder = orderId; setBusy(true); setError('');
    try {
      if (catalog?.testMode) {
        const value = await api<JobOrder>('/job-commerce/orders/' + order.id + '/complete-test', {method: 'POST'});
        if (currentOrder.current === requestedOrder) setOrder(value);
      }
      else {
        const session = await api<{redirectUrl: string}>('/job-commerce/orders/' + order.id + '/payment-session', {method: 'POST'});
        if (currentOrder.current !== requestedOrder) return;
        const target = new URL(session.redirectUrl);
        if (target.protocol !== 'https:') throw new Error(t('commerce.paymentUnavailable'));
        window.location.assign(target.href);
      }
    } catch (e) {if (currentOrder.current === requestedOrder) setError(e instanceof Error ? e.message : String(e));}
    finally {if (currentOrder.current === requestedOrder) setBusy(false);}
  }
  async function cancel() {
    if (busy || !order) return; const requestedOrder = orderId; setBusy(true); setError('');
    try {const value = await api<JobOrder>('/job-commerce/orders/' + order.id + '/cancel', {method: 'POST'}); if (currentOrder.current === requestedOrder) setOrder(value);}
    catch (e) {if (currentOrder.current === requestedOrder) setError(e instanceof Error ? e.message : String(e));} finally {if (currentOrder.current === requestedOrder) setBusy(false);}
  }
  if (order.status === 'PAID') return <div className={s.page}><section className={s.success} aria-live="polite"><span className={s.successIcon}>✓</span><span className={s.eyebrow}>{t('commerce.' + order.code)}</span><h1>{t('commerce.success')}</h1><p>{t(order.intent === 'UPGRADE' ? 'commerce.upgradeSuccess' : 'commerce.successHint')}</p><p><strong>{order.jobTitle}</strong><br/>{order.companyName}</p>{order.provider === 'local-test' && <p className={s.notice}>{t('commerce.testMode')} | {t('commerce.testHint')}</p>}<button className={s.primary} onClick={() => router.replace(returnTo)}>{t('commerce.continue')} →</button></section></div>;
  return <div className={s.page}><Link className={s.text} href={returnTo}>← {t('commerce.back')}</Link><div className={s.checkout}>
    <section><header className={s.headline}><span className={s.eyebrow}>Talentio | {t('commerce.checkout')}</span><h1>{t('commerce.checkout')}</h1><p>{t('commerce.checkoutHint')}</p></header>
      {error && <div className={s.error} role="alert">{error}</div>}
      <div className={s.panel}><h2>{t('commerce.' + (order.status === 'PENDING' ? catalog.testMode ? 'testMode' : 'PENDING' : order.status))}</h2>
        <p>{t('commerce.' + (order.status === 'REVIEW' ? 'reviewHint' : order.status !== 'PENDING' ? 'orderExpired' : catalog.testMode ? 'testHint' : catalog.paymentAvailable ? 'checkoutHint' : 'paymentUnavailable'))}</p>
        {order.status === 'PENDING' ? <><button className={s.primary} disabled={busy || (!catalog.testMode && !catalog.paymentAvailable)} onClick={() => void pay()}>{t(busy ? 'saving' : catalog.testMode ? 'commerce.testContinue' : 'commerce.pay')} →</button><p className={s.muted}>{t('commerce.noRecurring')}</p><button className={s.text} disabled={busy} onClick={() => void cancel()}>{t('commerce.cancelOrder')}</button></>
          : order.status !== 'REVIEW' && <Link className={s.primary} href={packageHref(order.jobId, returnTo)}>{t('commerce.choose')} →</Link>}
      </div>
    </section>
    <aside className={s.panel + ' ' + s.receipt}><h2>{t('commerce.summary')}</h2><span className={s.status}>{t('commerce.' + order.code)}</span><h3 style={{fontSize: '1.1rem', marginBottom: 6}}>{order.jobTitle}</h3><p style={{marginTop: 0}}>{order.companyName}</p>
      <dl><div><dt>{t('commerce.pricing')}</dt><dd>{t('commerce.' + order.code)}</dd></div><div><dt>{t('commerce.' + (order.intent === 'UPGRADE' ? 'upgrade' : order.intent === 'RENEW' ? 'renew' : 'perJob'))}</dt><dd>{money(order.amount, locale, order.currency)}</dd></div><div className={s.total}><dt>{t('commerce.total')}</dt><dd>{money(order.amount, locale, order.currency)}</dd></div></dl>
      <p>{t('commerce.' + (order.intent === 'UPGRADE' ? 'upgradeHint' : 'subtitle'))}</p>
      <p className={s.muted} style={{fontSize: '.7rem', overflowWrap: 'anywhere'}}>#{order.id}</p>
    </aside>
  </div></div>;
}
