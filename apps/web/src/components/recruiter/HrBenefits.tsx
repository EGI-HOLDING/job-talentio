'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, apiBlob } from '@/lib/api';
import { postOnce } from '@/lib/hr-benefits';
import { useI18n } from '@/lib/i18n';
import s from './RecruiterWorkspace.module.css';
import { Link } from '@/lib/navigation';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { packageHref } from '@/lib/jobCommerce';
export function CompanyBenefits({ companyId, companySlug }: { companyId: string; companySlug: string }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    setLoading(true);
    const load = () =>
      api('/benefits/companies/' + companyId)
        .then((value) => {
          if (active) {
            setData(value);
            setError('');
          }
        })
        .catch((error) => {
          if (active && error instanceof ApiError && error.status === 404) setData(null);
          if (active && !(error instanceof ApiError && error.status === 404))
            setError(error.message);
        }).finally(() => { if (active) setLoading(false); });
    void load();
    const timer = setInterval(() => void load(), 60000);
    window.addEventListener('hr-benefits-updated', load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('hr-benefits-updated', load);
    };
  }, [companyId, retry]);
  const featuredUntil = data?.companyId === companyId ? data.featuredUntil : null;
  const active = Boolean(featuredUntil && new Date(featuredUntil) > new Date());
  return <section className={s.promotion} aria-labelledby="company-promotion-title">
    <header><span className={s.promotionIcon}><WorkspaceIcon kind="building" /></span><div><h2 id="company-promotion-title">{t('rw.promotionTitle')}</h2><p>{t('rw.promotionHint')}</p></div></header>
    {loading ? <p role="status">{t('loading')}</p> : error ? <div className={s.promotionError} role="alert"><p>{t('ew.loadFailed')}</p><button type="button" className={s.secondary} onClick={() => setRetry(value => value + 1)}>{t('workspace.retry')}</button></div> : <>
      <div className={s.promotionStatus}><div><span className={s.promotionLabel}>{t('hr.featured')}</span><strong>{t(active ? 'rw.promotionActive' : 'rw.promotionInactive')}</strong></div><span className={s.status} data-status={active ? 'PUBLISHED' : 'EXPIRED'}>{t(active ? 'rw.promotionActiveBadge' : 'rw.promotionInactiveBadge')}</span></div>
      {active && <div className={s.promotionPeriod}><WorkspaceIcon kind="calendar" /><div><span>{t('rw.promotionEnds')}</span><time dateTime={featuredUntil}>{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(featuredUntil))}</time></div></div>}
      <p className={s.promotionNote}>{t('rw.promotionPackageHint')}</p>
      <Link className={s.secondary} href={'/companies/' + companySlug}>{t('rec.publicPage')}<WorkspaceIcon kind="external" /></Link>
    </>}
  </section>;
}

export function JobBenefits({ jobId, status }: { jobId: string; status: string }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = () =>
    api('/benefits/jobs/' + jobId)
      .then(setData)
      .catch((error) => {
        if (!(error instanceof ApiError && error.status === 404)) setError(error.message);
      });
  useEffect(() => {
    let active = true;
    api('/benefits/jobs/' + jobId)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [jobId, status]);
  async function boost() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await postOnce('/benefits/jobs/' + jobId + '/boost');
      await load();
      window.dispatchEvent(new Event('hr-benefits-updated'));
    } catch (error) {
      setError(error instanceof Error ? error.message : t('ew.loadFailed'));
    } finally {
      setBusy(false);
    }
  }
  if (!data) return null;
  return (
    <div className={s.jobBenefits}>
      <strong className={s.jobPackageName}>{t('hr.package.' + data.code)}</strong>
      <span className={s.jobPackageMeta}>
        {data.expiresAt
          ? <>{t('hr.expires')} <time dateTime={data.expiresAt}>{new Intl.DateTimeFormat(locale, {day: 'numeric', month: 'short', year: 'numeric'}).format(new Date(data.expiresAt))}</time></>
          : t('hr.startsOnPublish')}
      </span>
      {(!data.selected || data.code !== 'PREMIUM' || (data.expiresAt && new Date(data.expiresAt) <= new Date())) && <Link className={s.jobPackageLink} href={packageHref(jobId)}>{t('commerce.' + (data.expiresAt && new Date(data.expiresAt) <= new Date() ? 'renew' : !data.selected ? 'choose' : 'upgrade'))}<span aria-hidden="true">→</span></Link>}
      {data.activeBoost ? (
        <span className={s.jobPackageMeta}>
          {t('hr.boostUntil')} {new Date(data.activeBoost.endsAt).toLocaleString(locale)}
        </span>
      ) : (
        data.boostEnabled &&
        data.boostRemainingSeconds > 0 &&
        status === 'PUBLISHED' && (
          <details>
            <summary>
              {t('hr.boost')} | {Math.round(data.boostRemainingSeconds / 360) / 10} {t('hr.hours')}
            </summary>
            <p>
              {t('hr.boostEffective').replace(
                '{hours}',
                String(Math.round(data.boostEffectiveSeconds / 360) / 10),
              )}
            </p>
            <button
              type="button"
              className={s.secondary}
              disabled={busy}
              onClick={() => void boost()}
            >
              {t(busy ? 'saving' : 'hr.activateBoost')}
            </button>
          </details>
        )
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export function DatabaseCvAccess({
  profileId,
  companyId,
}: {
  profileId: string;
  companyId: string;
}) {
  const { t } = useI18n();
  const request = useRef(0);
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    ++request.current;
    setData(null);
    setError('');
    api('/profiles/candidates/' + profileId + '/access?companyId=' + companyId)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      ++request.current;
    };
  }, [profileId, companyId]);
  async function download() {
    if (busy) return;
    const version = request.current;
    setBusy(true);
    setError('');
    try {
      const blob = await apiBlob(
        '/profiles/candidates/' + profileId + '/database-cv?companyId=' + companyId,
      );
      if (version !== request.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const extension =
        blob.type === 'application/pdf'
          ? 'pdf'
          : blob.type === 'application/msword'
            ? 'doc'
            : blob.type ===
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              ? 'docx'
              : 'bin';
      anchor.download = 'candidate-cv.' + extension;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (version === request.current)
        setError(error instanceof Error ? error.message : t('ew.loadFailed'));
    } finally {
      if (version === request.current) setBusy(false);
    }
  }
  if (!data?.canReadCv) return null;
  return (
    <section>
      <h3>{t('hr.databaseCv')}</h3>
      <button className={s.secondary} disabled={busy} onClick={() => void download()}>
        {t(busy ? 'loading' : 'hr.downloadDatabaseCv')}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
