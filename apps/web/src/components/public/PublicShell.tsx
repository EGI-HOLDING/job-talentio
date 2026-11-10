'use client';

import type { ReactNode } from 'react';
import { usePathname } from '@/lib/navigation';
import s from './PublicPages.module.css';
import { useApplicationPresentation } from '../screening/ApplicationPresentation';

export function PublicShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { focused } = useApplicationPresentation();
  const auth = /^\/(login|forgot-password|reset-password|verify-email|confirm-email-change)$/.test(path);
  const publicPage = !/^\/(dashboard|settings|messages|talent|candidates|billing)(\/|$)/.test(path);
  const employeeFlowPage = path === '/dashboard/employee/resume-builder' || path.startsWith('/onboarding/') || path.startsWith('/apply/');
  const workspacePage = path === '/jobs'
    || path === '/talent'
    || path.startsWith('/dashboard/recruiter')
    || path === '/dashboard/employee'
    || path.startsWith('/candidates/')
    || path === '/messages'
    || path === '/settings'
    || path.startsWith('/billing/');
  const className = focused ? s.focusFlowPage : employeeFlowPage ? s.appFlowPage : workspacePage ? s.appPage : auth ? s.auth : publicPage ? s.publicPage : undefined;
  return <main className={className}>{children}</main>;
}
