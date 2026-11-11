'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import s from './HrFlow.module.css';

type GroupScope = {
  id: string;
  name: string;
  scopeRevision: string;
  members: Array<{id: string; name: string; family?: string}>;
};

export function JobPositionGroupScope({id, confirmed, approved, disabled, onConfirm}:{
  id: string;
  confirmed?: string | null;
  approved?: ReadonlyArray<{jobTitleId: string}>;
  disabled: boolean;
  onConfirm: (revision: string) => void;
}) {
  const c = useHrCopy();
  const [scope, setScope] = useState<GroupScope>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(!confirmed);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    api<GroupScope>('/meta/positions/groups/'+encodeURIComponent(id)+'/job-scope',{
      signal:controller.signal,cacheMode:'no-store',
    }).then(result => {
      if(!controller.signal.aborted)setScope(result);
    }).catch(() => {
      if(!controller.signal.aborted){setScope(undefined);setFailed(true);}
    });
    return () => controller.abort();
  }, [id, reload]);

  const current = scope?.id === id ? scope : undefined;
  const approvedIds = new Set(approved?.map(member => member.jobTitleId));
  const count = approved && current
    ? current.members.filter(member => approvedIds.has(member.id)).length
    : current?.members.length;
  const confirmedCurrent = !!current && confirmed === current.scopeRevision;
  return <div className={s.groupScope}>
    <div className={s.groupScopeHeader}>
      <strong>{count === undefined
        ? c(failed ? 'Cakupan belum tersedia' : 'Memuat cakupan…')
        : `${count} ${c('posisi tercakup')}`}</strong>
      <button type="button" className={s.link} aria-expanded={open} disabled={disabled} onClick={()=>{
        setOpen(!open);
        if(!open){setScope(undefined);setReload(previous=>previous+1);}
      }}>{c(open?'Tutup cakupan':'Lihat cakupan')}</button>
    </div>
    {failed && <p role="status">{c('Cakupan tidak dapat dimuat.')} <button type="button" className={s.link}
      onClick={()=>setReload(previous=>previous+1)}>{c('Coba muat katalog lagi')}</button></p>}
    {count === 0 && <p role="status">{c('Cakupan saat ini kosong. Lowongan tidak ditargetkan berdasarkan kelompok ini.')}</p>}
    {approved && current && !confirmedCurrent && current.members.length > 0 && <p>{c('Katalog berubah. Tinjau daftar sebelum memperbarui cakupan.')}</p>}
    {open && current && !!current.members.length && <>
      <ul className={s.groupScopeMembers}>{current.members.map(member=><li key={member.id}>
        <span>{member.name}</span>
        {member.family && <small>{member.family}</small>}
        {approved && !approvedIds.has(member.id) && !confirmedCurrent && <small>{c('Belum disetujui')}</small>}
      </li>)}</ul>
      {confirmedCurrent ? <p role="status">{c('Cakupan dikonfirmasi')}</p> :
        <button type="button" className={s.secondary} disabled={disabled}
          onClick={()=>onConfirm(current.scopeRevision)}>{c(approved?'Perbarui cakupan':'Konfirmasi cakupan')}</button>}
    </>}
  </div>;
}
