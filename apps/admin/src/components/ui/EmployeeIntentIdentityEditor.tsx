'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CatalogParentSelect } from './CatalogParentSelect';
type Identity = {
    familyId: string | null;
    canonicalRoleId: string | null;
    approved: boolean;
    approvedAliasIds: string[];
    aliases: Array<{
        id: string;
        alias: string;
    }>;
};
export function EmployeeIntentIdentityEditor({ id }: {
    id: string;
}) {
    const [value, setValue] = useState<Identity | null>(null), [families, setFamilies] = useState<Array<{
        id: string;
        code: string;
        name: string;
    }>>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
    useEffect(() => { let active = true; Promise.all([api<Identity>('/admin/employee-matching/roles/' + id), api<typeof families>('/admin/employee-matching/families')]).then(([role, rows]) => { if (active) {
        setValue(role);
        setFamilies(rows);
    } }).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; }; }, [id]);
    async function save() { if (!value)
        return; setBusy(true); setError(''); try {
        const { familyId, canonicalRoleId, approved, approvedAliasIds } = value;
        const body = { familyId, canonicalRoleId, approved, approvedAliasIds };
        await api('/admin/employee-matching/roles/' + id, { method: 'PATCH', body: JSON.stringify(body) });
        setSaved(true);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    async function addFamily() { const code = window.prompt('ISCO minor group code (3 digits)'); if (!code)
        return; const name = window.prompt('Official family name'); if (!name)
        return; setBusy(true); try {
        const family = await api<{
            id: string;
            code: string;
            name: string;
        }>('/admin/employee-matching/families', { method: 'POST', body: JSON.stringify({ code, name, source: 'ILO ISCO-08', sourceVersion: '2008' }) });
        setFamilies(old => [...old.filter(f => f.id !== family.id), family]);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return <section style={{ display: 'grid', gap: 10, border: '1px solid var(--border)', padding: 12 }}><h3>Candidate position identity</h3><p>Only an approved position and family can enter candidate recommendations. Related professions are excluded.</p>{error && <p role="alert">{error}</p>}{value && <fieldset disabled={busy}><label>Occupation family<select value={value.familyId ?? ''} onChange={e => { setSaved(false); setValue({ ...value, familyId: e.target.value }); }}><option value="">Needs review</option>{families.map(f => <option key={f.id} value={f.id}>{f.code} - {f.name}</option>)}</select></label><button type="button" onClick={() => void addFamily()}>Add official family</button><CatalogParentSelect type="jobTitle" label="Equivalent canonical position (leave empty for this position itself)" value={value.canonicalRoleId ?? ''} onChange={canonicalRoleId => { setSaved(false); setValue({ ...value, canonicalRoleId: canonicalRoleId || null }); }}/><label><input type="checkbox" checked={value.approved} onChange={e => { setSaved(false); setValue({ ...value, approved: e.target.checked }); }}/>Identity reviewed and approved</label><strong>Approved matching synonyms</strong>{value.aliases.map(alias => <label key={alias.id}><input type="checkbox" checked={value.approvedAliasIds.includes(alias.id)} onChange={e => { setSaved(false); setValue({ ...value, approvedAliasIds: e.target.checked ? [...value.approvedAliasIds, alias.id] : value.approvedAliasIds.filter(a => a !== alias.id) }); }}/>{alias.alias}</label>)}<button type="button" onClick={() => void save()} disabled={!value.familyId}>{busy ? 'Saving...' : 'Save matching identity'}</button>{saved && <p role="status">Matching identity saved.</p>}</fieldset>}</section>;
}
