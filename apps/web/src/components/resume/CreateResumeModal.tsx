'use client';
import {CvUploadDialog} from '@/components/profile/CvUploadDialog';
export type CreateResumeResult={id:string;method:'upload'};
type Props={open:boolean;busy?:boolean;defaultJobTitle?:string;defaultTitle?:string;onCancel:()=>void;onCreated:(value:CreateResumeResult)=>void|Promise<void>};
export function CreateResumeModal({open,onCancel,onCreated}:Props){return open?<CvUploadDialog onClose={onCancel} onUploaded={async id=>{await onCreated({id,method:'upload'});}} />:null;}
