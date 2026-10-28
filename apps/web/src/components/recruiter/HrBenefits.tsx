'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, apiBlob } from '@/lib/api';
import { postOnce } from '@/lib/hr-benefits';
import { useI18n } from '@/lib/i18n';
import s from './RecruiterWorkspace.module.css';
import { Link } from '@/lib/navigation';
import { packageHref } from '@/lib/jobCommerce';
export function CompanyBenefits({ companyId }: { companyId: string }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
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
        });
    void load();
    const timer = setInterval(() => void load(), 60000);
    window.addEventListener('hr-benefits-updated', load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('hr-benefits-updated', load);
    };
  }, [companyId]);
  if (error) return <p role="alert">{error}</p>;
  if (
    !data ||
    data.companyId !== companyId ||
    !data.featuredUntil ||
    new Date(data.featuredUntil) <= new Date()
  )
    return null;
  return (
    <div className={s.summary}>
      {data.featuredUntil && new Date(data.featuredUntil) > new Date() && (
        <span>
          {t('hr.featuredUntil')} {new Date(data.featuredUntil).toLocaleDateString(locale)}
        </span>
      )}
    </div>
  );
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
