'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import s from './RecruiterWorkspace.module.css';

export function RecruiterJobActions({job,companyId,busy,onEdit,onStatus}:{job:any;companyId:string;busy:boolean;onEdit:()=>void;onStatus:(next:string)=>void}) {
  const {t}=useI18n();const id=useId();const trigger=useRef<HTMLButtonElement>(null);const menu=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState<{top:number;left:number}|null>(null);
  useEffect(()=>{
    if(!position)return;
    menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    function close(event:Event){if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setPosition(null);}
    function key(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();setPosition(null);trigger.current?.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){const items=Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)')||[]);const index=items.indexOf(document.activeElement as HTMLElement);event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}else if(event.key==='Tab')setPosition(null);}
    const reposition=()=>setPosition(null);
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);window.addEventListener('resize',reposition);document.addEventListener('scroll',close,true);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);window.removeEventListener('resize',reposition);document.removeEventListener('scroll',close,true);};
  },[position]);
  function toggle(){if(position){setPosition(null);return;}const rect=trigger.current!.getBoundingClientRect();setPosition({top:Math.min(rect.bottom+5,window.innerHeight-280),left:Math.max(10,Math.min(rect.right-210,window.innerWidth-220))});}
  return <><button ref={trigger} className={s.icon} aria-label={t('rw.actions')+': '+job.title} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position?id:undefined} onClick={toggle} disabled={busy}>⋮</button>{position&&createPortal(<div ref={menu} id={id} className={s.menuPopup} role="menu" aria-label={job.title} style={position} onClick={()=>setPosition(null)}><button role="menuitem" onClick={onEdit}>{t('rec.edit')}</button><Link role="menuitem" href={'/jobs/'+job.id}>{t('rec.publicPage')}</Link><Link role="menuitem" href={'/talent?matchJobId='+job.id+'&company='+companyId+'&sort=match'}>{t('findTalent')}</Link>{job.status!=='PUBLISHED'&&<button role="menuitem" onClick={()=>onStatus('PUBLISHED')}>{t(job.status==='CLOSED'?'rec.reopen':job.status==='PAUSED'?'rec.resumeJob':'rec.publish')}</button>}{job.status==='PUBLISHED'&&<button role="menuitem" onClick={()=>onStatus('PAUSED')}>{t('rec.pause')}</button>}{job.status!=='CLOSED'&&<button role="menuitem" onClick={()=>onStatus('CLOSED')}>{t('rec.closeJob')}</button>}</div>,document.body)}</>;
}
