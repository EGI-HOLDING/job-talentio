'use client';
import {useId,useState} from 'react';
import type {DesiredSelection} from '@job-talentio/shared';
import {JobTitleInput} from '../ui/JobTitleInput';
import {useI18n} from '@/lib/i18n';
import {useEmployeeIntentText} from '@/lib/i18n/employeeIntent';
import s from './Onboarding.module.css';

export type NamedPositionSelection=DesiredSelection&{name:string};
export const positionGroupsUiEnabled=process.env.NEXT_PUBLIC_POSITION_GROUPS_ENABLED==='true';
export function PositionSelectionPicker({value,onChange}:{value:NamedPositionSelection[];onChange:(value:NamedPositionSelection[])=>void}){
  const id=useId(),{locale}=useI18n(),m=useEmployeeIntentText();
  const [text,setText]=useState('');
  const group=locale==='id'?'Semua posisi dalam kelompok':'All positions in this group';
  const role=locale==='id'?'Posisi spesifik':'Specific position';
  return <div className={s.fields}>
    <label htmlFor={id}>{m('positionsYouAreLookingFor')}</label>
    <JobTitleInput id={id} name="" matchingOnly selectionCatalog selectionLabels={{group,role}} normalizeSeniority={false} minLength={1} value={text} onValueChange={setText} selectedIds={value.map(v=>v.id)} disabled={value.length>=10} placeholder={m('searchThePositionCatalog')} onPickSelection={selection=>{if(value.length<10&&!value.some(v=>v.kind===selection.kind&&v.id===selection.id))onChange([...value,selection]);setText('');}}/>
    <small>{locale==='id'?'Pilih hingga 10 kelompok atau posisi. Pilihan kelompok mencakup seluruh anggota yang terpetakan.':'Select up to 10 groups or specific positions. A group includes all mapped members.'}</small>
    <div className={s.chips}>{value.map(selection=><span key={selection.kind+':'+selection.id} title={selection.kind==='GROUP'?group:role}>{selection.name}<small>{selection.kind==='GROUP'?group:role}</small><button type="button" aria-label={m('remove')+selection.name} onClick={()=>onChange(value.filter(v=>v.kind!==selection.kind||v.id!==selection.id))}>×</button></span>)}</div>
  </div>;
}
