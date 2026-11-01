'use client';
import {useEffect} from 'react';
import {useRouter} from '@/lib/navigation';
import {WorkspaceLoading} from '@/components/employee/WorkspacePrimitives';
import {CVS_HREF} from './types';
export function CvEditorWorkspace(){const router=useRouter();useEffect(()=>{router.replace(CVS_HREF);},[router]);return <WorkspaceLoading />;}
