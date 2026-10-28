'use client';
import { Suspense, type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/lib/navigation';
import { authLink, authRoleFrom, safeAuthNext, type AuthRole } from '@/lib/authReturn';
import { useI18n } from '@/lib/i18n';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & {
  href: '/login' | '/register' | '/forgot-password';
  accountRole?: AuthRole;
  next?: string | null;
};

function AuthLinkInner({ href, accountRole, next, ...props }: Props) {
  const params = useSearchParams();
  const path = usePathname();
  const context = path === '/employers' || params.get('invite') ? 'RECRUITER' : authRoleFrom(params.get('role'));
  const role = accountRole || context;
  return <Link {...props} href={authLink(href, next === undefined ? params.get('next') : next, role, role === 'RECRUITER' ? params.get('invite') : null)} />;
}

export function AuthLink(props: Props) {
  const { href, accountRole, next, ...rest } = props;
  return <Suspense fallback={<Link {...rest} href={authLink(href, next || null, accountRole || 'EMPLOYEE')} />}><AuthLinkInner {...props} /></Suspense>;
}

function ReturnNoticeInner() {
  const { t } = useI18n();
  const params = useSearchParams();
  return safeAuthNext(params.get('next')) ? <p className="muted" style={{fontSize: '.76rem'}}>{t('public.returnHint')}</p> : null;
}

export function AuthReturnNotice() {
  return <Suspense fallback={null}><ReturnNoticeInner /></Suspense>;
}
