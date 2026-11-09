import { redirect } from 'next/navigation';

export default async function ApplyPage({params}:{params:Promise<{locale:string;jobId:string}>}) {
  const {locale,jobId}=await params;
  redirect(`/${locale}/jobs/${encodeURIComponent(jobId)}`);
}
