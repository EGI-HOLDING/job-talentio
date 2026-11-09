'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { TaraRunner } from './TaraPreparation';
import s from './TaraAssessment.module.css';
export type TaraSummary = { status: string; version: number | null; cvScore: number | null; screeningScore: number | null; finalScore: number | null; rank: number | null; pdfReady: boolean; summary: string | null; methodology?: string | null; assessedClaims?: number; scoreReason?: string | null; reevaluationStatus?: string | null };
const statuses: Record<string, string> = { LEGACY: 'Lamaran sebelum Tara', PENDING: 'Penilaian sedang diproses', FAILED: 'Penilaian perlu dipulihkan', READY: 'Penilaian selesai', NEEDS_REVIEW: 'Perlu tinjauan HR' };
const score = (n: number | null) => n == null ? 'Belum tersedia' : n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
export function TaraScores({ data, detailed = false }: { data: TaraSummary; detailed?: boolean }) {
 const uiCopy=useHrCopy();
    if(data.status === 'LEGACY') return <div className={s.compact}><small>{uiCopy("Lamaran sebelum Tara")}</small>{data.cvScore !== null && <p>Kecocokan CV: {score(data.cvScore)}</p>}</div>;
    return <div className={detailed ? s.overview : s.compact}>
        {detailed && <header><h3>{uiCopy("Ringkasan penilaian")}</h3><span className={s.badge}>{statuses[data.status] ?? statuses.PENDING}</span></header>}
        <div className={s.scores}>{[['Kecocokan CV', data.cvScore, 'Kecocokan isi CV dengan persyaratan lowongan.'], ['Dukungan klaim CV', data.screeningScore, 'Penjelasan kandidat atas klaim yang diperiksa Tara.'], ['Skor gabungan', data.finalScore, '50% kecocokan CV + 50% dukungan klaim.']].map(([label, value, hint]) => <div key={String(label)} title={String(hint)}><span>{label}</span><strong>{score(value as number | null)}{detailed && value !== null && <small>/100</small>}</strong>{detailed && <p>{hint}</p>}</div>)}</div>
        {detailed ? <p className={s.note}>{data.assessedClaims ? `${data.assessedClaims} klaim CV diperiksa. ` : ''}{data.scoreReason === 'CV_SCORE_UNAVAILABLE' ? 'Skor gabungan menunggu pemrosesan CV.' : data.scoreReason === 'LEGACY_INSUFFICIENT_EVIDENCE' ? (data.reevaluationStatus === 'FAILED' ? 'Penilaian ulang memerlukan pemulihan teknis. Hasil sebelumnya tetap ditampilkan.' : 'Hasil metodologi sebelumnya belum memiliki skor lengkap; penilaian ulang sedang dipersiapkan.') : data.status === 'PENDING' ? 'Jawaban tersimpan. Penilaian sedang diproses.' : data.status === 'FAILED' ? 'Jawaban tersimpan. Penilaian memerlukan pemulihan teknis.' : 'Hasil membantu meninjau bukti klaim yang diperiksa; keputusan rekrutmen tetap dilakukan HR.'}</p> : <small>{statuses[data.status] ?? statuses.PENDING}</small>}
    </div>;
}
type Claim = { claimId: string; score?: number; status: string; reason: string; evidence?: { questionId: string; quote: string }[]; contradictions: { left: { source: string; quote: string }; right: { source: string; quote: string } }[] };
type Assessment = Omit<TaraSummary, 'rank' | 'summary'> & { coverFilename: string | null; reevaluationStatus?: string | null; result: { summary: string; strengths: string[]; gaps: string[]; interviewQuestions: string[]; criteria: { criterionId: string; score: number | null; reason: string; evidence: { questionId: string; quote: string }[] }[]; claims: Claim[] } | null; rubric: { criteria: { id: string; name: string }[] }; plan: { claims: { id: string; quote: string }[] }; questions?: { id: string; question: string; answer: string | null; timedOut: boolean }[]; revisions?: { id: string; promptVersion: string; createdAt: string }[] };
const claimStatus = (status: string) => status === 'SUPPORTED' ? 'Didukung penjelasan' : status === 'CLARIFY' ? 'Ketidaksesuaian perlu dikonfirmasi' : 'Dukungan belum memadai';
export function TaraAssessment({ applicationId, requirements }: { applicationId: string; requirements?: ReactNode }) {
 const uiCopy=useHrCopy();
    const [historical, setHistorical] = useState<{ id: string; summary: string; cvScore: number | null; screeningScore: number | null; finalScore: number | null; pdfUrl: string | null } | null>(null);
    const [data, setData] = useState<Assessment | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => {
        let active = true, timer: ReturnType<typeof setTimeout>; const controller = new AbortController(); setData(null); setHistorical(null); setError('');
        async function load() { try { const value = await api<Assessment>('/ai-screening/applications/' + applicationId + '/assessment', { signal: controller.signal }); if (!active) return; setData(value); setError(''); if (value.status === 'PENDING' || !value.pdfReady || (value.methodology && !value.methodology.includes('v3.') && value.reevaluationStatus !== 'FAILED')) timer = setTimeout(load, 6000); } catch (e) { if (active) { setError((e as Error).message); timer = setTimeout(load, 6000); } } }
        void load(); return () => { active = false; controller.abort(); clearTimeout(timer); };
    }, [applicationId]);
    async function download(kind: 'report' | 'cover-letter') { setBusy(true); setError(''); const tab = window.open('about:blank', '_blank'); if (tab) tab.opener = null;
        try { const next = await api<{ url: string }>('/ai-screening/applications/' + applicationId + '/' + kind); if (tab) tab.location.href = next.url; else window.location.assign(next.url); }
        catch (e) { tab?.close(); setError((e as Error).message); } finally { setBusy(false); }
    }
    return <div className={s.assessment} aria-label={uiCopy("Penilaian screening Tara")}>
        {error && <p role="alert" className={s.error}>{error}</p>}
        {data ? <TaraScores data={{ ...data, rank: null, summary: data.result?.summary ?? null }} detailed/> : <div role="status"><TaraRunner small/><p>Memuat penilaian&#x2026;</p></div>}
        {requirements}
        {data && <section className={s.screening}><header><div><h3>{uiCopy("Screening Tara")}</h3><span className={s.badge}>{statuses[data.status] ?? statuses.PENDING}</span></div><div className={s.downloads}><button disabled={!data.pdfReady || busy} onClick={() => void download('report')}>{data.pdfReady ? '↓ Unduh laporan PDF' : 'PDF sedang disiapkan'}</button>{data.coverFilename && <button disabled={busy} onClick={() => void download('cover-letter')}>Cover letter ↗</button>}</div></header>
        {data.result && <><p className={s.summary}>{data.result.summary}</p><div className={s.findings}><div><h4>{uiCopy("Kekuatan yang didukung")}</h4>{data.result.strengths.length ? <ul>{data.result.strengths.map(v => <li key={v}>{v}</li>)}</ul> : <p className={s.empty}>Belum ada kekuatan yang dapat dirangkum dari jawaban saat ini.</p>}</div><div><h4>{uiCopy("Prioritas konfirmasi")}</h4>{data.result.gaps.length ? <ol>{data.result.gaps.map(v => <li key={v}>{v}</li>)}</ol> : <p className={s.empty}>Tidak ada prioritas tambahan dari screening ini.</p>}</div></div>
        <h3>{uiCopy("Penilaian klaim CV")}</h3><p className={s.muted}>Nilai menunjukkan dukungan penjelasan atas klaim yang diperiksa, dalam skala 0&#x2013;4.</p>
        <div className={s.claims}>{data.result.claims.map((c, i) => <article key={c.claimId} className={s.claim} data-status={c.status}><header><h4>Klaim {i + 1}</h4><span className={s.badge}>{claimStatus(c.status)}</span><strong>{c.score === undefined ? 'Metodologi sebelumnya' : c.score + '/4'}</strong></header><blockquote><small>{uiCopy("Kutipan CV")}</small>“{data.plan.claims.find(p => p.id === c.claimId)?.quote}”</blockquote><p>{c.reason}</p>
        {(c.evidence ?? []).map((e, j) => <blockquote key={e.questionId + ':' + j}><small>Jawaban kandidat &#xb7; Pertanyaan {(data.questions?.findIndex(q => q.id === e.questionId) ?? -1) + 1 || 'terkait'}</small>“{e.quote}”</blockquote>)}
        {c.contradictions.map((p, j) => <div className={s.discrepancy} key={j}><strong>{uiCopy("Konfirmasikan perbedaan ini")}</strong><p>{p.left.source === 'CV' ? 'CV' : 'Jawaban'}: “{p.left.quote}”</p><p>{p.right.source === 'CV' ? 'CV' : 'Jawaban'}: “{p.right.quote}”</p></div>)}</article>)}</div>
        <details className={s.details}><summary>{uiCopy("Pertanyaan dan jawaban yang mendukung penilaian")}</summary>{data.questions?.map((q, i) => <div key={q.id}><h4>{i + 1}. {q.question}</h4><p>{q.answer || 'Tidak ada jawaban tersimpan.'}</p>{q.timedOut && <small>Jawaban terakhir disimpan saat waktu berakhir.</small>}</div>)}</details>
        <h3>{uiCopy("Pertanyaan lanjutan untuk HR")}</h3>{data.result.interviewQuestions.length ? <ol className={s.questions}>{data.result.interviewQuestions.map(q => <li key={q}>{q}</li>)}</ol> : <p className={s.empty}>Belum ada pertanyaan tambahan yang disarankan.</p>}
        <p className={s.note}>Screening membantu meninjau bukti klaim; bukan verifikasi fakta. Keputusan akhir tetap di tangan HR.</p>
        {(data.revisions?.length ?? 0) > 0 && <details className={s.details}><summary>Riwayat penilaian &#xb7; {data.revisions!.length} revisi</summary>{data.revisions!.map(r => <div key={r.id}><button className={s.historyButton} onClick={async () => { try { const v = await api<{ id: string; result: { summary: string }; cvScore: number | null; screeningScore: number | null; finalScore: number | null; pdfUrl: string | null }>('/ai-screening/applications/' + applicationId + '/assessment/revisions/' + r.id); setHistorical({ ...v, summary: v.result.summary }); } catch(e) { setError((e as Error).message); } }}>{new Date(r.createdAt).toLocaleString('id-ID')} &#xb7; {r.promptVersion === data.methodology ? 'Metodologi aktif' : 'Metodologi sebelumnya'}</button>{historical?.id === r.id && <div><p>{historical.summary}</p><p>CV: {score(historical.cvScore)} &#xb7; Tara: {score(historical.screeningScore)} &#xb7; Gabungan: {score(historical.finalScore)}</p>{historical.pdfUrl && <a href={historical.pdfUrl} target="_blank" rel="noopener noreferrer">Unduh PDF revisi ini ↗</a>}</div>}</div>)}</details>}
        </>}
        </section>}
    </div>;
}
