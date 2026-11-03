'use client';
import { useEmployeeIntentText } from '@/lib/i18n/employeeIntent';
import { useId, useState } from 'react';
import { JobTitleInput } from '@/components/ui/JobTitleInput';
import s from './Onboarding.module.css';

export function EmployeePositionPicker({ value, selectedIds = [], onChange }: {
  value: string[];
  selectedIds?: string[];
  onChange: (names: string[], ids?: string[]) => void;
}) {
  const m = useEmployeeIntentText();
  const id = useId();
  const [text, setText] = useState('');
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const legacy = value.slice(selectedIds.length);
  function add(role: { id: string; name: string }) {
    if (selectedIds.includes(role.id) || selectedIds.length >= 10) return;
    const remaining = legacy.filter((name, i) => reviewIndex === null ? name !== role.name : i !== reviewIndex);
    if (selectedIds.length + remaining.length >= 10) return;
    onChange([...value.slice(0, selectedIds.length), role.name, ...remaining], [...selectedIds, role.id]);
    setText('');
    setReviewIndex(null);
  }
  return <div className={s.fields}>
    <label htmlFor={id}>{m('positionsYouAreLookingFor')}</label>
    <div className={s.inputAction}>
      <JobTitleInput id={id} name="" value={text} onValueChange={setText} matchingOnly selectedIds={selectedIds}
        onPickPosition={add} normalizeSeniority={false} minLength={1} disabled={selectedIds.length >= 10}
        placeholder={m('searchThePositionCatalog')} />
    </div>
    <div className={s.chips}>{selectedIds.map((roleId, i) => <span key={roleId}>{value[i] || roleId}
      <button type="button" aria-label={m('remove') + (value[i] || roleId)} onClick={() => onChange(value.filter((_, n) => n !== i), selectedIds.filter(id => id !== roleId))}>×</button>
    </span>)}</div>
    <small>{m('positionsHint')}</small>
    {legacy.length > 0 && <div role="status"><p>{m('legacyPositionsHint')}</p><div className={s.chips}>{legacy.map((name, i) => <span key={i}><button type="button" className={s.legacyPosition} aria-pressed={reviewIndex === i} onClick={() => { setReviewIndex(i); setText(name); document.getElementById(id)?.focus(); }}>{name}</button><button type="button" aria-label={m('remove') + name} onClick={() => { setReviewIndex(null); onChange(value.filter((_, n) => n !== selectedIds.length + i), selectedIds); }}>×</button></span>)}</div></div>}
  </div>;
}
