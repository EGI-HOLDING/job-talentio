import { Suspense } from 'react';
import { RoleGate } from '@/components/auth/RoleGate';
import { JobOrders } from '@/components/recruiter/JobOrders';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
export default function OrdersPage() { return <RoleGate role="RECRUITER"><Suspense fallback={<WorkspaceLoading/>}><JobOrders/></Suspense></RoleGate>; }
