'use client';
import { useEffect,useRef,useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import s from './CandidateWorkspace.module.css';

export function CandidatePdfPreview({url,name}:{url:string;name:string}){
 const container=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[width,setWidth]=useState(500),[busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{const element=container.current;if(!element)return;const observer=new ResizeObserver(()=>setWidth(Math.max(200,element.clientWidth-32)));observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  let live=true,task:ReturnType<typeof import('pdfjs-dist')['getDocument']>|undefined;
  setPdf(null);setPage(1);setError('');setBusy(true);
  void import('pdfjs-dist').then(lib=>{
   if(!live)return;
   lib.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
   task=lib.getDocument({url,disableAutoFetch:true});
   return task.promise;
  }).then(document=>{if(live&&document)setPdf(document);}).catch(()=>{if(live){setBusy(false);setError('Pratinjau belum dapat ditampilkan. Buka berkas untuk melihat CV lengkap.');}});
  return()=>{live=false;void task?.destroy();};
 },[url]);
 useEffect(()=>{
  if(!pdf||!canvas.current)return;
  let live=true,render:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;
  setBusy(true);setError('');
  void pdf.getPage(page).then(async documentPage=>{
   if(!live||!canvas.current)return;
   const base=documentPage.getViewport({scale:1}),viewport=documentPage.getViewport({scale:Math.min(2,width/base.width)}),ratio=Math.min(window.devicePixelRatio||1,2),element=canvas.current;
   element.width=Math.floor(viewport.width*ratio);element.height=Math.floor(viewport.height*ratio);element.style.width=Math.floor(viewport.width)+'px';element.style.height=Math.floor(viewport.height)+'px';
   render=documentPage.render({canvas:element,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});await render.promise;
   if(live)setBusy(false);
  }).catch(()=>{if(live){setBusy(false);setError('Halaman ini belum dapat ditampilkan. Coba buka berkas CV.');}});
  return()=>{live=false;render?.cancel();};
 },[pdf,page,width]);
 return <div ref={container} className={s.pdfPreview}>
  {pdf&&<nav aria-label="Halaman CV" className={s.pdfNavigation}><button type="button" className={s.square} disabled={page<=1||busy} aria-label="Halaman CV sebelumnya" onClick={()=>setPage(n=>n-1)}>‹</button><span>Halaman {page} dari {pdf.numPages}</span><button type="button" className={s.square} disabled={page>=pdf.numPages||busy} aria-label="Halaman CV berikutnya" onClick={()=>setPage(n=>n+1)}>›</button></nav>}
  {busy&&!error&&<p role="status" className={s.muted}>Memuat halaman CV…</p>}
  {error?<div className={s.cvFallback}><p>{error}</p><a href={url} className={s.secondary} target="_blank" rel="noreferrer">Buka CV</a></div>:<canvas ref={canvas} role="img" aria-label={'Halaman '+page+' CV '+name} data-rendered={pdf&&!busy?'true':'false'}/>}
 </div>;
}
