import { ScreeningInvitation } from '@/components/screening/ScreeningInvitation';
export default async function ScreeningInvitationPage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <ScreeningInvitation token={token}/>;}
