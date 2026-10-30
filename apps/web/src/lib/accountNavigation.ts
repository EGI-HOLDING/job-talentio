import { localeFromPathname, stripLocale, withLocale } from './locale';

export const EMPLOYER_JOBS = '/dashboard/recruiter?tab=jobs';

export function employerJobHref(id: string, section = 'applicants', companyId?: string | null): string {
  const params = new URLSearchParams();
  if (section === 'kanban' || section === 'details') params.set('section', section);
  if (companyId) params.set('company', companyId);
  return '/dashboard/recruiter/jobs/' + encodeURIComponent(id) + (params.size ? '?' + params : '');
}

export function isEmployerRole(role?: string | null): boolean {
  return role === 'RECRUITER' || role === 'SUPER_ADMIN';
}

function internalUrl(href: string): URL | null {
  if (!href.startsWith('/') || href.startsWith('//') || /[\\\x00-\x1f]/.test(href)) return null;
  try {
    const url = new URL(href, 'https://jobtalent.internal');
    return url.origin === 'https://jobtalent.internal' ? url : null;
  } catch { return null; }
}

/** Shared policy for links, router navigation, auth returns and direct page entry. */
export function accountHref(role: string | null | undefined, href: string): string {
  if (!role) return href;
  const url = internalUrl(href);
  if (!url) return href;
  const path = stripLocale(url.pathname).replace(/\/$/, '') || '/';
  let target: string | null = null;
  if (isEmployerRole(role)) {
    if (path === '/talent' || (path === '/dashboard/recruiter' && url.searchParams.get('tab') === 'candidates')) {
      const job = url.searchParams.get('matchJobId') || url.searchParams.get('job');
      target = job ? employerJobHref(job, 'candidates', url.searchParams.get('company')) : EMPLOYER_JOBS;
    }
    if (path === '/dashboard/recruiter' && url.searchParams.has('job') && (!url.searchParams.get('tab') || url.searchParams.get('tab') === 'pipeline')) {
      target = employerJobHref(url.searchParams.get('job')!, 'applicants', url.searchParams.get('company'));
      if (url.searchParams.get('application')) target += '&application=' + encodeURIComponent(url.searchParams.get('application')!);
    }
    if (/^\/billing(\/|$)/.test(path) || (path === '/dashboard/recruiter' && url.searchParams.get('tab') === 'billing')) target = EMPLOYER_JOBS;
    if ((path === '/' && url.searchParams.get('audience') !== 'seekers') || path === '/jobs' || /^\/(dashboard\/employee|onboarding\/employee)(\/|$)/.test(path)) target = EMPLOYER_JOBS;
  } else if (role === 'EMPLOYEE' && path === '/dashboard/employee' && !['applications', 'saved', 'alerts', 'profile'].includes(url.searchParams.get('tab') || '')) {
    target = '/jobs?mode=for-you';
  } else if (role === 'EMPLOYEE' && /^\/(dashboard\/recruiter|talent|candidates|billing)(\/|$)/.test(path)) {
    target = '/jobs';
  }
  if (!target && path === '/messages' && url.searchParams.has('role') && (role === 'EMPLOYEE' || role === 'RECRUITER')) {
    if (url.searchParams.get('role') === role) return href;
    url.searchParams.set('role', role);
    target = path + url.search + url.hash;
  }
  if (!target && isEmployerRole(role) && path === '/dashboard/recruiter' && url.searchParams.has('job') && !url.searchParams.has('tab')) {
    url.searchParams.set('tab', 'pipeline');
    target = path + url.search + url.hash;
  }
  if (!target) return href;
  const locale = localeFromPathname(url.pathname);
  return locale ? withLocale(locale, target) : target;
}

export function employerWorkspaceHref(tab = 'jobs', companyId?: string | null): string {
  const params = new URLSearchParams({ tab });
  if (companyId) params.set('company', companyId);
  return '/dashboard/recruiter?' + params;
}

/** Return destinations are internal, role-appropriate pages, never arbitrary URLs. */
export function accountReturnHref(role: string | null | undefined, value?: string | null): string | null {
  if (!value || value.length > 2000) return null;
  const url = internalUrl(value);
  if (!url) return null;
  const path = stripLocale(url.pathname);
  const shared = /^\/(jobs\/[^/]+|companies\/[^/]+|explore\/companies|news(?:\/[^/]+)?|messages|settings)\/?$/.test(path);
  const allowed = isEmployerRole(role)
    ? shared || /^\/(dashboard\/recruiter(?:\/(?:orders|support|jobs\/[^/]+(?:\/package)?))?|talent|candidates\/[^/]+|checkout\/[^/]+|pricing)\/?$/.test(path)
    : shared || path === '/jobs' || path === '/explore/companies' || (role === 'EMPLOYEE' && path === '/dashboard/employee');
  return allowed ? accountHref(role, path + url.search + url.hash) : null;
}

export function jobBackHref(role: string | null | undefined, returnTo?: string | null, companyId?: string | null): string {
  return accountReturnHref(role, returnTo) || (isEmployerRole(role) ? employerWorkspaceHref('jobs', companyId) : '/jobs');
}

export function jobDetailHref(id: string, returnTo?: string): string {
  return '/jobs/' + encodeURIComponent(id) + (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : '');
}
