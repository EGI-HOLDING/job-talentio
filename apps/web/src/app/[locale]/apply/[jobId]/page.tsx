import { TaraApplication } from '@/components/screening/TaraApplication';

export default async function ApplyPage({params}:{params:Promise<{jobId:string}>}) {
  const {jobId}=await params;
  return <TaraApplication jobId={jobId}/>;
}
