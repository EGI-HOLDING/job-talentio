'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import s from './TaraApplication.module.css';
export type TaraSummary = {
    status: string;
    version: number | null;
    cvScore: number | null;
    screeningScore: number | null;
    finalScore: number | null;
    rank: number | null;
    pdfReady: boolean;
    summary: string | null;
};
const statuses: Record<string, string> = { LEGACY: 'Lamaran sebelum Tara', PENDING: 'Penilaian sedang diproses', FAILED: 'Penilaian perlu dipulihkan', READY: 'Penilaian lengkap', NEEDS_REVIEW: 'Perlu tinjauan HR' };
const score = (n: number | null) => n === null ? '—' : n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
export function TaraScores({ data }: {
    data: TaraSummary;
}) { return <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.8 }}><strong>Skor akhir {score(data.finalScore)}</strong><br />CV {score(data.cvScore)} · Tara {score(data.screeningScore)}<br /><span>{statuses[data.status] ?? 'Penilaian sedang diproses'}{data.version ? ' · v' + data.version : ''}</span></div>; }
type Result = {
    summary: string;
    strengths: string[];
    gaps: string[];
    interviewQuestions: string[];
    criteria: {
        criterionId: string;
        score: number | null;
        reason: string;
        evidence: {
            questionId: string;
            quote: string;
        }[];
    }[];
    claims: {
        claimId: string;
        status: string;
        reason: string;
        contradictions: {
            left: {
                source: string;
                quote: string;
            };
            right: {
                source: string;
                quote: string;
            };
        }[];
    }[];
};
type Assessment = {
    status: string;
    cvScore: number | null;
    screeningScore: number | null;
    finalScore: number | null;
    version: number;
    pdfReady: boolean;
    coverFilename: string | null;
    result: Result | null;
    rubric: {
        criteria: {
            id: string;
            name: string;
        }[];
    };
    plan: {
        claims: {
            id: string;
            quote: string;
        }[];
    };
};
export function TaraAssessment({ applicationId }: {
    applicationId: string;
}) {
    const [data, setData] = useState<Assessment | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => {
        let active = true;
        const load = () => api<Assessment>('/ai-screening/applications/' + applicationId + '/assessment').then(v => {
            if (active)
                setData(v);
        }).catch(e => {
            if (active)
                setError(e.message);
        });
        void load();
        const timer = setInterval(() => void load(), 6000);
        return () => { active = false; clearInterval(timer); };
    }, [applicationId]);
    async function download(kind: 'report' | 'cover-letter') {
        setBusy(true);
        setError('');
        try {
            const next = await api<{
                url: string;
            }>('/ai-screening/applications/' + applicationId + '/' + kind);
            window.open(next.url, '_blank', 'noopener,noreferrer');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return <section className={s.panel} aria-label="Penilaian screening Tara" style={{ margin: '20px 0' }}><h3>Screening Tara</h3>{error && <p role="alert">{error}</p>}{!data ? <p>Memuat penilaian…</p> : <><TaraScores data={{ ...data, rank: null, summary: data.result?.summary ?? null }}/><div className={s.actions} style={{ justifyContent: 'flex-start' }}><button className={s.outline} disabled={!data.pdfReady || busy} onClick={() => void download('report')}>{data.pdfReady ? 'Unduh laporan PDF' : 'PDF sedang disiapkan'}</button>{data.coverFilename && <button className={s.outline} disabled={busy} onClick={() => void download('cover-letter')}>Cover letter ↗</button>}</div>{data.result && <><p>{data.result.summary}</p><div className={s.rules}><div><h4>Kekuatan yang didukung</h4><ul>{data.result.strengths.map(v => <li key={v}>{v}</li>)}</ul></div><div><h4>Prioritas konfirmasi</h4><ul>{data.result.gaps.map(v => <li key={v}>{v}</li>)}</ul></div></div>{data.result.criteria.map(c => <div key={c.criterionId} style={{ padding: '14px 0', borderTop: '1px solid #e1e6ef' }}><strong>{data.rubric.criteria.find(r => r.id === c.criterionId)?.name} · {c.score === null ? 'Belum cukup bukti' : c.score + '/4'}</strong><p>{c.reason}</p>{c.evidence.map(e => <blockquote key={e.questionId}>“{e.quote}”</blockquote>)}</div>)}<details><summary>Klaim CV yang digali</summary>{data.result.claims.map(c => <div key={c.claimId}><blockquote>CV: “{data.plan.claims.find(p => p.id === c.claimId)?.quote}”</blockquote><strong>{c.status === 'SUPPORTED' ? 'Didukung penjelasan kandidat' : c.status === 'CLARIFY' ? 'Ada ketidaksesuaian yang perlu dikonfirmasi' : 'Belum cukup bukti'}</strong><p>{c.reason}</p>{c.contradictions.map((p, i) => <p key={i}>“{p.left.quote}” dibandingkan dengan “{p.right.quote}”.</p>)}</div>)}</details><h4>Pertanyaan lanjutan untuk HR</h4><ul>{data.result.interviewQuestions.map(q => <li key={q}>{q}</li>)}</ul><p className={s.hint}>Percakapan menunjukkan dukungan terhadap klaim, bukan verifikasi fakta. Keputusan rekrutmen tetap dilakukan HR.</p></>}</>}</section>;
}
