'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Link } from '@/lib/navigation';
import { employerWorkspaceHref } from '@/lib/accountNavigation';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { preferredCompany, rememberCompany } from './RecruiterPrimitives';
import { HrSupport } from './HrSupport';
import s from './HrSupport.module.css';

type Membership = { companyId: string; company: { name: string } };
export function RecruiterSupport() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const requestedCompany = params.get('company');
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setMemberships(null); setError(false);
    api<Membership[]>('/companies/mine').then(mine => { if (alive) setMemberships(mine); }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [locale, retry]);
  const membership = memberships && (requestedCompany ? memberships.find(row => row.companyId === requestedCompany) : preferredCompany(memberships));
  useEffect(() => { if (membership) rememberCompany(membership.companyId); }, [membership?.companyId]);
  return <div className={s.page}><div className={s.shell}>
    <Link className={s.back} href={employerWorkspaceHref('jobs', membership?.companyId)}><WorkspaceIcon kind="left" />{t('rw.backJobs')}</Link>
    {error ? <div className={s.error} role="alert"><span>{t('ew.loadFailed')}</span><button type="button" className={s.secondary} onClick={() => setRetry(value => value + 1)}>{t('workspace.retry')}</button></div> : !memberships ? <WorkspaceLoading /> : !membership ? <div className={s.empty}><WorkspaceIcon kind="building" /><h1>{t('rw.noCompany')}</h1><p>{t('rw.noCompanyHint')}</p></div> : <HrSupport key={membership.companyId} companyId={membership.companyId} companyName={membership.company.name} />}
  </div></div>;
}
