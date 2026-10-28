'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { api, getSession } from '@/lib/api';
import { usePathname, useRouter } from '@/lib/navigation';
import { safeAuthNext } from '@/lib/authReturn';
import { useI18n } from '@/lib/i18n';
import { useAccountRole } from '@/lib/useAccountRole';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
export function RecruiterOnboardingGate({children}: {children: ReactNode}) {
  const pathname = usePathname(), router = useRouter(), {t} = useI18n();
  const role = useAccountRole(), verificationKey = pathname + ':' + role;
  const protectedPage = /^\/(dashboard\/recruiter|settings|messages|talent|candidates)(\/|$)/.test(pathname) && !pathname.endsWith('/package');
  const [verified, setVerified] = useState(''), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const session = getSession();
    if (!protectedPage || role !== 'RECRUITER' || session?.user.role !== 'RECRUITER') {setVerified(verificationKey); return;}
    const abort = new AbortController(); setError('');
    api<{status: string}>('/recruiter-onboarding', {signal: abort.signal}).then(state => {
      if (abort.signal.aborted) return;
      if (state.status === 'IN_PROGRESS') router.replace('/onboarding/recruiter?next=' + encodeURIComponent(safeAuthNext(window.location.pathname + window.location.search) || '/dashboard/recruiter?tab=jobs'));
      else setVerified(verificationKey);
    }).catch(e => {if (!abort.signal.aborted) setError(e.message);});
    return () => abort.abort();
  }, [pathname, protectedPage, role, verificationKey, retry, router]);
  if (protectedPage && role === 'RECRUITER' && verified !== verificationKey) return error ? <div role="alert" style={{padding: 32}}>{error}<br/><button onClick={() => setRetry(n => n + 1)}>{t('workspace.retry')}</button></div> : <WorkspaceLoading/>;
  return <>{children}</>;
}
