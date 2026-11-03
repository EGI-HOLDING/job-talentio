'use client';
import { useEmployeeIntentText } from '@/lib/i18n/employeeIntent';
import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import s from './Onboarding.module.css';
type Position = {
    id: string;
    name: string;
    nameId?: string | null;
    family: {
        name: string;
        nameId?: string | null;
    } | null;
};
export function EmployeePositionPicker({ value, selectedIds = [], onChange }: {
    value: string[];
    selectedIds?: string[];
    onChange: (names: string[], ids?: string[]) => void;
}) {
    const m = useEmployeeIntentText();
    const { locale } = useI18n();
    const id = useId();
    const isId = locale === 'id';
    const [q, setQ] = useState('');
    const [options, setOptions] = useState<Position[]>([]);
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => { let active = true; setLoading(true); const timer = setTimeout(() => api<{
        items: Position[];
    }>('/meta/employee-positions?q=' + encodeURIComponent(q), { auth: false }).then(r => { if (active) {
        setOptions(r.items);
        setError(false);
    } }).catch(() => { if (active)
        setError(true); }).finally(() => { if (active)
        setLoading(false); }), 200); return () => { active = false; clearTimeout(timer); }; }, [q, retry]);
    const label = (r: Position) => isId ? r.nameId || r.name : r.name;
    function add(role: Position) { if (selectedIds.includes(role.id) || selectedIds.length >= 10)
        return; onChange([...value.slice(0, selectedIds.length), role.name], [...selectedIds, role.id]); setQ(''); }
    return <div className={s.fields}><label htmlFor={id}>{m("positionsYouAreLookingFor")}</label><input id={id} value={q} maxLength={160} placeholder={m("searchThePositionCatalog")} onChange={e => setQ(e.target.value)}/>
    <p>{m("positionsHint")}</p>
    {value.length > selectedIds.length && <p role="status">{m("legacyPositionsHint")}</p>}
    <div className={s.chips}>{selectedIds.map((roleId, i) => <span key={roleId}>{value[i] || roleId}<button type="button" aria-label={(m("remove")) + (value[i] || roleId)} onClick={() => onChange(value.filter((_, n) => n !== i), selectedIds.filter(id => id !== roleId))}>×</button></span>)}</div>
    {error ? <p role="alert">{m("couldNotLoadThePositionCatalog")} <button type="button" onClick={() => setRetry(n => n + 1)}>{m("retry")}</button></p> : loading ? <p role="status">{m("loadingPositions")}</p> : <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 6 }}>{options.filter(r => !selectedIds.includes(r.id)).map(role => <button type="button" key={role.id} className={s.secondary} disabled={selectedIds.length >= 10} onClick={() => add(role)} style={{ textAlign: 'left', display: 'block' }}><strong>{label(role)}</strong><small style={{ display: 'block' }}>{isId ? role.family?.nameId || role.family?.name : role.family?.name}</small></button>)}{!options.length && <p>{m("positionsEmpty")}</p>}</div>}
  </div>;
}
