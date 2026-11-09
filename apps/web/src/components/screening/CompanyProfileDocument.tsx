'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useState } from 'react';
import { api, apiUpload } from '@/lib/api';
import s from './TaraApplication.module.css';
export function CompanyProfileDocument({ companyId, canManage = true, recommendation = false }: {
    companyId?: string;
    canManage?: boolean;
    recommendation?: boolean;
}) {
 const uiCopy=useHrCopy();
    const [enabled, setEnabled] = useState(false), [doc, setDoc] = useState<{
        filename: string;
        status: string;
    } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => {
        let alive = true;
        api<{
            enabled: boolean;
        }>('/ai-screening/capabilities').then(v => {
            if (alive)
                setEnabled(v.enabled);
        }).catch(() => undefined);
        return () => { alive = false; };
    }, []);
    useEffect(() => {
        if (!enabled || !companyId || recommendation)
            return;
        let alive = true;
        const load = () => api<{
            document: typeof doc;
        }>('/ai-screening/companies/' + companyId + '/document').then(v => {
            if (alive)
                setDoc(v.document);
        }).catch(e => {
            if (alive)
                setError(e.message);
        });
        void load();
        const timer = setInterval(() => void load(), 6000);
        return () => { alive = false; clearInterval(timer); };
    }, [enabled, companyId, recommendation]);
    if (!enabled)
        return null;
    if (recommendation)
        return <p className={s.hint}>Punya company profile? Nanti kamu bisa mengunggahnya di pengaturan perusahaan agar Tara mengenal konteks pekerjaanmu. Opsional, bisa dilengkapi kapan saja.</p>;
    return <section className={s.panel} style={{ margin: '20px 0' }}><h3>{uiCopy("Company profile ")}<small>(opsional)</small></h3><p className={s.hint}>Bantu Tara memahami konteks pekerjaan di perusahaanmu. Dokumen tersimpan privat.</p>{doc && <p>{doc.filename} &#xb7; {doc.status === 'READY' ? 'Siap digunakan' : doc.status === 'FAILED' ? 'Belum bisa dibaca; coba unggah ulang' : 'Sedang dibaca\u2026'}</p>}{canManage && <label className={s.upload}><strong>{busy ? 'Mengunggah\u2026' : 'Pilih PDF atau DOCX \u00b7 Maks. 5 MB'}</strong><input className={s.fileInput} type="file" accept=".pdf,.docx" aria-label={uiCopy("Unggah company profile")} disabled={busy} onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file)
                    return;
                if (file.size > 5 * 1024 * 1024) {
                    setError('Maksimal 5 MB, ya.');
                    return;
                }
                setBusy(true);
                setError('');
                const body = new FormData();
                body.append('file', file);
                void apiUpload<{
                    document: typeof doc;
                }>('/ai-screening/companies/' + companyId + '/document', body).then(v => setDoc(v.document)).catch(e => setError(e.message)).finally(() => setBusy(false));
            }}/></label>}{error && <p role="alert">{error}</p>}</section>;
}
