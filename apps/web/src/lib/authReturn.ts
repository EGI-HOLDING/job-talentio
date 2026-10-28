import { stripLocale } from './locale';
import { getSession } from './api';
import { accountHref } from './accountNavigation';

export type AuthRole = 'EMPLOYEE' | 'RECRUITER';

export function authRoleFrom(value: string | null | undefined): AuthRole {
  return value === 'RECRUITER' ? 'RECRUITER' : 'EMPLOYEE';
}

export function currentAuthRole(): AuthRole {
  if (typeof window === 'undefined') return 'EMPLOYEE';
  const params = new URLSearchParams(window.location.search);
  if (params.get('invite')) return 'RECRUITER';
  if (params.has('role')) return authRoleFrom(params.get('role'));
  if (/^\/(employers|talent|candidates|dashboard\/recruiter|billing)(\/|$)/.test(stripLocale(window.location.pathname))) return 'RECRUITER';
  return authRoleFrom(getSession()?.user.role);
}

export function roleMismatchKey(actual: string, expected: AuthRole): string | null {
  if (actual === expected) return null;
  return actual === 'EMPLOYEE' ? 'authRole.wrongEmployee' : 'authRole.wrongEmployer';
}

export function authRoleErrorKey(message: string): string | null {
  if (message.includes('AUTH_ROLE_MISMATCH_EMPLOYEE')) return 'authRole.wrongEmployee';
  if (message.includes('AUTH_ROLE_MISMATCH_RECRUITER')) return 'authRole.wrongEmployer';
  return null;
}

/** Only internal app paths may be used as an authentication return destination. */
export function safeAuthNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x1f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://jobtalent.internal');
    if (url.origin !== 'https://jobtalent.internal') return null;
    const path = stripLocale(url.pathname);
    if (/^\/(login|register|forgot-password|reset-password|verify-email|confirm-email-change|onboarding)(\/|$)/.test(path)) return null;
    return `${path}${url.search}${url.hash}`;
  } catch { return null; }
}

export function currentAuthNext(): string | null {
  return typeof window === 'undefined' ? null : safeAuthNext(new URLSearchParams(window.location.search).get('next'));
}

export function authDestination(fallback: string): string {
  // Admin stays on the separate configured admin application.
  if (/^https?:/.test(fallback)) return fallback;
  const session=getSession();
  const next=accountHref(session?.user.role, currentAuthNext() || fallback);
  if(session?.user.role==='EMPLOYEE'&&session.user.employeeOnboarding?.status==='IN_PROGRESS') return '/onboarding/employee?next='+encodeURIComponent(next);
  if(session?.user.role==='RECRUITER'&&session.user.recruiterOnboarding?.status==='IN_PROGRESS') return '/onboarding/recruiter?next='+encodeURIComponent(next);
  return next;
}

export function authLink(path: '/login' | '/register' | '/forgot-password', next = currentAuthNext(), role: AuthRole = currentAuthRole(), invite?: string | null): string {
  const safe = safeAuthNext(next);
  const params = new URLSearchParams({ role });
  if (safe) params.set('next', safe);
  if (invite) params.set('invite', invite);
  return `${path}?${params}`;
}

export function loginForCurrentPage(): string {
  if (typeof window === 'undefined') return '/login';
  return authLink('/login', `${window.location.pathname}${window.location.search}`);
}
