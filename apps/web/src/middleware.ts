import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeFromPathname, pickLocale, stripLocale } from '@/lib/locale';

/**
 * Every page lives under /uz, /ru, /en or /id so search engines can index one URL
 * per language. Unprefixed requests are redirected using the saved cookie,
 * then the browser's Accept-Language, then the default locale.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const current = localeFromPathname(pathname);

  if (current) {
    const path = stripLocale(pathname);
    const retiredBilling = /^\/billing(\/|$)/.test(path)
      || (path === '/dashboard/recruiter' && request.nextUrl.searchParams.get('tab') === 'billing');
    const employeeTab = path === '/dashboard/employee' ? request.nextUrl.searchParams.get('tab') : null;
    const retiredEmployeeDashboard = path === '/dashboard/employee'
      && !['applications', 'saved', 'alerts', 'profile'].includes(employeeTab || '');
    const destination = retiredBilling
      ? `/${current}/dashboard/recruiter?tab=jobs`
      : retiredEmployeeDashboard
        ? `/${current}/jobs?mode=for-you`
        : null;
    const response = destination
      ? NextResponse.redirect(new URL(destination, request.url))
      : NextResponse.next();
    if (request.cookies.get(LOCALE_COOKIE)?.value !== current) {
      response.cookies.set(LOCALE_COOKIE, current, {
        path: '/',
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: 'lax',
      });
    }
    return response;
  }

  const locale = pickLocale(
    request.cookies.get(LOCALE_COOKIE)?.value,
    request.headers.get('accept-language'),
  );
  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;
  url.search = search;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[\\w]+$).*)'],
};
