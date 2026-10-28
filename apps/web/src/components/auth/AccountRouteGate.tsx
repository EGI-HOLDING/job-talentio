'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/lib/navigation';
import { useAccountRole } from '@/lib/useAccountRole';
import { accountHref } from '@/lib/accountNavigation';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';

/** Stops wrong-role pages before their child components mount or load private data. */
function AccountRouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const role = useAccountRole();
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  // Workspace tabs live in the query string; dropping it turns valid employee
  // pages such as ?tab=profile into the retired default dashboard destination.
  const query = searchParams.toString();
  const currentHref = pathname + (query ? `?${query}` : '');
  const destination = accountHref(role, currentHref);
  const redirect = destination !== currentHref;
  useEffect(() => { if (redirect) router.replace(destination); }, [destination, redirect, router]);
  const roleSpecific = /^\/(jobs\/?$|dashboard\/|onboarding\/|talent|candidates|billing)/.test(pathname);
  return redirect || (roleSpecific && !ready) ? <WorkspaceLoading /> : <>{children}</>;
}

export function AccountRouteGate({ children }: { children: ReactNode }) {
  return <Suspense fallback={<WorkspaceLoading />}><AccountRouteGuard>{children}</AccountRouteGuard></Suspense>;
}
