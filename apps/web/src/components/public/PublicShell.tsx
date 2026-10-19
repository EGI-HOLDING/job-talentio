'use client';

import type { ReactNode } from 'react';
import { usePathname } from '@/lib/navigation';
import s from './PublicPages.module.css';

export function PublicShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const auth = /^\/(login|forgot-password|reset-password|verify-email|confirm-email-change)$/.test(path);
  const publicPage = !/^\/(dashboard|settings|messages|talent|candidates|billing)(\/|$)/.test(path);
  const employeeFlowPage = path === '/dashboard/employee/resume-builder';
  const workspacePage = path === '/jobs'
    || path === '/explore/companies'
    || path === '/talent'
    || path.startsWith('/dashboard/recruiter')
    || path === '/dashboard/employee'
    || path.startsWith('/candidates/')
    || path === '/messages'
    || path === '/settings'
    || path.startsWith('/billing/');
  const className = employeeFlowPage ? s.appFlowPage : workspacePage ? s.appPage : auth ? s.auth : publicPage ? s.publicPage : undefined;
  return <main className={className}>{children}</main>;
}
