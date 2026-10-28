import { Suspense } from 'react';
import { RoleGate } from '@/components/auth/RoleGate';
import { JobCheckout } from '@/components/recruiter/JobCheckout';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
export default function CheckoutPage() { return <RoleGate role="RECRUITER"><Suspense fallback={<WorkspaceLoading/>}><JobCheckout/></Suspense></RoleGate>; }
