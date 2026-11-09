'use client';
import { useSyncExternalStore } from 'react';
import { api, getSession } from './api';
export type ImportFile = { id: string; name: string; size: number; loaded: number; status: 'queued'|'uploading'|'processing'|'done'|'error'|'duplicate'; error?: string; file?: File; needsReselect?:boolean };
export type ImportBatch = { id: string; companyId: string; jobId?: string; userId: string; files: ImportFile[]; error?: string };
let batches: ImportBatch[] = [];
const empty: ImportBatch[] = [];
const listeners = new Set<() => void>();
let persistTimer:ReturnType<typeof setTimeout>|undefined;
function persist(){if(typeof window==='undefined')return;for(const userId of new Set(batches.map(b=>b.userId)))try{localStorage.setItem('candidate-imports:'+userId,JSON.stringify(batches.filter(b=>b.userId===userId).map(b=>({...b,files:b.files.map(({file,...f})=>f)}))));}catch{/* A full browser store must not interrupt an upload. */}}
const notify = () => { batches = batches.map(b => ({ ...b, files: b.files.map(f => ({ ...f })) })); if(persistTimer)clearTimeout(persistTimer);persistTimer=setTimeout(persist,250);for(const listener of listeners)listener(); };
const update = (batchId:string,id:string,patch:Partial<ImportFile>) => { batches=batches.map(b=>b.id!==batchId?b:{...b,files:b.files.map(f=>f.id===id?{...f,...patch}:f)});notify(); };
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function useCandidateImports() { return useSyncExternalStore(subscribe,()=>batches,()=>empty); }
function upload(url:string,file:File,onProgress:(loaded:number)=>void) {
  return new Promise<void>((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.timeout=180000;
    xhr.setRequestHeader('Content-Type',mime(file));
    xhr.upload.onprogress=event=>onProgress(event.loaded);
    xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error('Upload belum berhasil. Coba lagi.'));
    xhr.onerror=()=>reject(Error('Koneksi terputus. Coba upload lagi.'));
    xhr.ontimeout=()=>reject(Error('Upload melewati batas waktu. Coba lagi.'));
    xhr.send(file);
  });
}
function mime(file:File){return /\.pdf$/i.test(file.name)?'application/pdf':/\.docx$/i.test(file.name)?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/msword';}
async function transfer(batchId:string,id:string) {
  const batch=batches.find(b=>b.id===batchId),item=batch?.files.find(f=>f.id===id);
  if(!batch||!item?.file)return;
  if(getSession()?.user.id!==batch.userId){update(batchId,id,{status:'error',error:'Masuk kembali ke akun yang memulai upload.'});return;}
  const file=item.file;
  update(batchId,id,{status:'uploading',error:undefined});
  try {
    const fresh=await api<{uploadUrl:string|null;status:string}>('/recruitment/candidates/'+id+'/upload-url',{method:'POST',body:'{}'});
    if(getSession()?.user.id!==batch.userId)throw Error('Masuk kembali ke akun yang memulai upload.');
    if(fresh.uploadUrl)await upload(fresh.uploadUrl,file,loaded=>update(batchId,id,{loaded}));
    if(getSession()?.user.id!==batch.userId)throw Error('Masuk kembali ke akun yang memulai upload.');
    const result=await api<{scoreStatus:string}>('/recruitment/candidates/'+id+'/upload-complete',{method:'POST',body:'{}'});
    update(batchId,id,{status:result.scoreStatus==='DUPLICATE'?'duplicate':'processing',loaded:file.size,file:undefined});
  } catch(error) {update(batchId,id,{status:'error',error:error instanceof Error?error.message:'Upload belum berhasil.'});}
}
const running=new Set<string>();
async function drain() {
  for(const batch of batches.filter(b=>b.userId===getSession()?.user.id))for(const file of batch.files){
    const key=batch.id+':'+file.id;
    if(running.size>=3)return;
    if(file.status!=='queued'||running.has(key))continue;
    running.add(key);void transfer(batch.id,file.id).finally(()=>{running.delete(key);void drain();});
  }
}
const registrations=new Map<string,{next:number;keys:Map<number,string>}>();
export async function startCandidateImport(companyId:string,jobId:string|undefined,files:File[]) {
  const userId=getSession()?.user.id;if(!userId)throw Error('Silakan masuk kembali.');
  const invalid=files.find(file=>! /\.(pdf|docx?)$/i.test(file.name)||file.size===0||file.size>5*1024*1024);
  if(invalid)throw Error(invalid.name+': gunakan PDF, DOC atau DOCX maksimal 5 MB.');
  const signature=JSON.stringify([userId,companyId,jobId,files.map(f=>[f.name,f.size,f.lastModified])]);
  const registration=registrations.get(signature)??{next:0,keys:new Map<number,string>()};registrations.set(signature,registration);
  // Chunk metadata requests, not the total number of files the HR user may import.
  for(let offset=registration.next;offset<files.length;offset+=100){
    if(getSession()?.user.id!==userId)throw Error('Gunakan akun yang memulai upload untuk melanjutkan.');
    const chunk=files.slice(offset,offset+100),key=registration.keys.get(offset)??crypto.randomUUID();registration.keys.set(offset,key);
    const data=await api<{id:string;files:Array<{id:string;clientId:string;status:string}>}>('/recruitment/imports',{method:'POST',body:JSON.stringify({companyId,jobId,requestKey:key,files:chunk.map((f,i)=>({clientId:String(i),filename:f.name,size:f.size,contentType:mime(f)}))})});
    if(!batches.some(b=>b.id===data.id))batches=[...batches,{id:data.id,companyId,jobId,userId,files:data.files.map(f=>({id:f.id,name:chunk[Number(f.clientId)].name,size:chunk[Number(f.clientId)].size,loaded:0,status:'queued' as const,file:chunk[Number(f.clientId)]}))}];
    registration.next=offset+chunk.length;notify();void drain();
    if(getSession()?.user.id!==userId)throw Error('Gunakan akun yang memulai upload untuk melanjutkan.');
  }
  registrations.delete(signature);
}
export function retryCandidateTransfer(batchId:string,id:string){update(batchId,id,{status:'queued',error:undefined,loaded:0});void drain();}
export function markCandidateProcessing(id:string){const batch=batches.find(b=>b.files.some(f=>f.id===id));if(batch)update(batch.id,id,{status:'processing',error:undefined});}
export function dismissCandidateImport(id:string){const batch=batches.find(b=>b.id===id);if(batch?.files.some(f=>['queued','uploading','processing'].includes(f.status)))return;batches=batches.filter(b=>b.id!==id);notify();if(batch)try{localStorage.setItem('candidate-imports:'+batch.userId,JSON.stringify(batches.filter(b=>b.userId===batch.userId).map(b=>({...b,files:b.files.map(({file,...f})=>f)}))));}catch{}}
const restored=new Set<string>();
export async function restoreCandidateImports(userId:string){
 if(!userId)return;if(restored.has(userId)){await refreshCandidateImports();void drain();return;}restored.add(userId);
 try{const stored=JSON.parse(localStorage.getItem('candidate-imports:'+userId)??'[]') as ImportBatch[];if(!Array.isArray(stored))return;
 for(const batch of stored){if(batch.userId!==userId||typeof batch.id!=='string'||!Array.isArray(batch.files)||batches.some(b=>b.id===batch.id))continue;batches.push({...batch,files:batch.files.map(({file,...f})=>['queued','uploading'].includes(f.status)?{...f,status:'error' as const,needsReselect:true,error:'Upload terhenti. Pilih kembali berkas yang sama untuk melanjutkan.'}:f)});}notify();await refreshCandidateImports();void drain();
 }catch{/* Invalid or unavailable local metadata cannot affect durable server work. */}
}
export function resumeCandidateTransfer(batchId:string,id:string,file:File){const batch=batches.find(b=>b.id===batchId),item=batch?.files.find(f=>f.id===id);if(!batch||!item||batch.userId!==getSession()?.user.id)throw Error('Gunakan akun yang memulai upload.');if(file.name!==item.name||file.size!==item.size)throw Error('Pilih berkas dengan nama dan ukuran yang sama.');update(batchId,id,{file,needsReselect:false,status:'queued',loaded:0,error:undefined});void drain();}
export async function refreshCandidateImports() {
  const userId=getSession()?.user.id;
  await Promise.all(batches.filter(b=>b.userId===userId&&b.files.some(f=>f.status==='processing'||f.needsReselect)).map(async batch=>{
    try{
      const result=await api<{files:Array<{id:string;scoreStatus:string;error?:string}>}>('/recruitment/imports/'+batch.id);
      for(const item of result.files){const local=batch.files.find(f=>f.id===item.id);if(!local||local.status!=='processing'&&!local.needsReselect)continue;
        if(['READY','EXTRACTED'].includes(item.scoreStatus)){update(batch.id,item.id,{status:'done',needsReselect:false,error:undefined,loaded:local.size});window.dispatchEvent(new Event('candidate-import-updated'));}
        else if(item.scoreStatus==='DUPLICATE')update(batch.id,item.id,{status:'duplicate',needsReselect:false,error:undefined,loaded:local.size});
        else if(['PENDING','PROCESSING'].includes(item.scoreStatus))update(batch.id,item.id,{status:'processing',needsReselect:false,error:undefined,loaded:local.size});
        else if(['FAILED','UNREADABLE','STALE'].includes(item.scoreStatus))update(batch.id,item.id,{status:'error',needsReselect:false,error:item.error??'Penilaian belum berhasil.'});
      }
    }catch{/* API errors leave durable work visible; the next poll retries. */}
  }));
}
