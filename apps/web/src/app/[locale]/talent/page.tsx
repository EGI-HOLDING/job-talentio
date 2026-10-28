import { redirect } from 'next/navigation';
import { employerJobHref, employerWorkspaceHref } from '@/lib/accountNavigation';
import { withLocale, type Locale } from '@/lib/locale';

export const dynamic = 'force-dynamic';

/** Old bookmarks keep their job context; there is no standalone talent page. */
export default async function LegacyTalentPage({params,searchParams}:{params:Promise<{locale:Locale}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {locale}=await params, query=await searchParams;
  const job=typeof query.matchJobId==='string'?query.matchJobId:'';
  const company=typeof query.company==='string'?query.company:undefined;
  redirect(withLocale(locale,job?employerJobHref(job,'candidates',company):employerWorkspaceHref('jobs',company)));
}
