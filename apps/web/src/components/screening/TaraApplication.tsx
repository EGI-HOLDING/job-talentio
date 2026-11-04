'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { api, apiUpload, getSession } from '@/lib/api';
import { localeUrl } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { jobAttribution, trackJobEvent } from '@/lib/hr-events';
import { rememberSource, readSource } from '@/lib/acquisition';
import s from './TaraApplication.module.css';
type Cv = {
    id: string;
    title: string;
    hasFile?: boolean;
    fileKey?: string;
    isPrimary?: boolean;
};
type Question = {
    id: string;
    text: string;
    draft: string;
    answer: string | null;
    shownAt: string | null;
    deadlineAt: string | null;
    timedOut: boolean;
};
type State = {
    id: string;
    status: string;
    revision: number;
    resumeId: string | null;
    applicationId: string | null;
    coverLetter: string;
    coverFilename: string | null;
    packetReady: boolean;
    preparationStatus: string;
    serverTime: string;
    error: string | null;
    questions: Question[];
    job: {
        id: string;
        title: string;
        companyName: string;
        city: string;
    };
};
const labels = ['CV', 'Cover letter', 'Kenalan', 'Aturan', 'Ngobrol', 'Selesai'];
const tara = '/images/tara/welcome.png';
export function TaraApplication({ jobId }: {
    jobId: string;
}) {
    const { locale } = useI18n();
    const [state, setState] = useState<State | null>(null), [step, setStep] = useState(0), [cvs, setCvs] = useState<Cv[]>([]), [selected, setSelected] = useState(''), [preview, setPreview] = useState('');
    const [cover, setCover] = useState(''), [coverMode, setCoverMode] = useState<'text' | 'file'>('text'), [answer, setAnswer] = useState('');
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [now, setNow] = useState(Date.now()), [name, setName] = useState(''), [tabReady, setTabReady] = useState(false);
    const sessionRef = useRef<State | null>(null), client = useRef(''), offset = useRef(0), answerRef = useRef(''), answerQuestion = useRef(''), heading = useRef<HTMLHeadingElement>(null), chatEnd = useRef<HTMLDivElement>(null), uploadRef = useRef<HTMLInputElement>(null);
    const mounted = useRef(true), writing = useRef<Promise<unknown>>(Promise.resolve()), sending = useRef(false);
    const url = (path: string) => localeUrl(locale, path);
    const accept = useCallback((next: State) => {
        if (!mounted.current)
            return;
        const previous = sessionRef.current;
        if (previous && previous.id === next.id) {
            if (next.revision < previous.revision)
                return;
            const order: Record<string, number> = { DRAFT: 0, ACTIVE: 1, GENERATING: 1, COMPLETED: 2, SUBMITTED: 3 };
            if (previous.revision === next.revision && order[next.status] < order[previous.status])
                return;
        }
        if (next.serverTime)
            offset.current = Date.parse(next.serverTime) - Date.now();
        sessionRef.current = next;
        setState(next);
        if (next.status === 'SUBMITTED')
            setStep(5);
        else if (next.status !== 'DRAFT')
            setStep(4);
    }, []);
    const loadCvs = useCallback(async () => {
        const p = await api<{
            resumes: Cv[];
        }>('/profiles/me');
        const available = (p.resumes ?? []).filter(c => c.hasFile || c.fileKey);
        setCvs(available);
        return available;
    }, []);
    useEffect(() => {
        mounted.current = true;
        client.current = crypto.randomUUID();
        const auth = getSession();
        if (!auth) {
            window.location.assign(url('/login?next=' + encodeURIComponent('/apply/' + jobId + window.location.search)));
            return;
        }
        if (!['EMPLOYEE', 'SUPER_ADMIN'].includes(auth.user.role)) {
            setError('Gunakan akun kandidat untuk melamar, ya.');
            return;
        }
        setName(auth.user.fullName.split(' ')[0]);
        rememberSource(jobId);
        void trackJobEvent(jobId, 'APPLY_START');
        void (async () => {
            const [next, list] = await Promise.all([api<State>('/ai-screening/jobs/' + jobId + '/draft', { method: 'POST' }), loadCvs()]);
            if (!mounted.current)
                return;
            if (next.status === 'SUBMITTED' && !next.id) {
                window.location.assign(url('/dashboard/employee?tab=applications'));
                return;
            }
            accept(next);
            setCover(next.coverLetter ?? '');
            setCoverMode(next.coverFilename ? 'file' : 'text');
            const resume = next.resumeId || list.find(c => c.isPrimary)?.id || list[0]?.id || '';
            setSelected(resume);
            if (next.status === 'DRAFT') {
                const saved = Number(localStorage.getItem('tara-page:' + next.id) || 0);
                setStep(Math.min(3, Math.max(0, saved)));
                accept(await api<State>('/ai-screening/sessions/' + next.id, { method: 'PATCH', body: JSON.stringify({ resumeId: !next.resumeId && resume ? resume : undefined, source: readSource(jobId) }) }));
                void jobAttribution(jobId).then(token => token ? api('/ai-screening/sessions/' + next.id, { method: 'PATCH', body: JSON.stringify({ funnelSession: token }) }) : undefined).catch(() => undefined);
            }
        })().catch(e => setError(e.message));
        return () => { mounted.current = false; };
        // Locale and job are fixed for the lifetime of this route.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobId, accept, loadCvs]);
    useEffect(() => {
        if (state?.id && state.status === 'DRAFT')
            localStorage.setItem('tara-page:' + state.id, String(step));
        heading.current?.focus();
    }, [step, state?.id, state?.status]);
    useEffect(() => {
        if (!selected) {
            setPreview('');
            return;
        }
        let active = true;
        setPreview('');
        api<{
            url: string;
        }>('/profiles/me/resumes/' + selected + '/download').then(v => {
            if (active)
                setPreview(v.url);
        }).catch(() => undefined);
        return () => { active = false; };
    }, [selected]);
    useEffect(() => {
        if (!state?.id || ['SUBMITTED'].includes(state.status))
            return;
        const poll = setInterval(() => { void api<State>('/ai-screening/sessions/' + state.id).then(accept).catch(() => setNotice('Koneksi terputus sebentar. Progresmu tersimpan, ya.')); }, 2500);
        return () => clearInterval(poll);
    }, [state?.id, state?.status, accept]);
    useEffect(() => {
        if (step !== 4 || !state?.id || state.status === 'SUBMITTED')
            return;
        let active = true;
        const claim = () => api<State>('/ai-screening/sessions/' + state.id + '/claim', { method: 'POST', body: JSON.stringify({ clientId: client.current }) }).then(next => {
            if (active) {
                setTabReady(true);
                accept(next);
            }
        }).catch(e => {
            if (active) {
                setTabReady(false);
                setError(e.message);
            }
        });
        void claim();
        const heartbeat = setInterval(() => void claim(), 8000);
        return () => { active = false; clearInterval(heartbeat); };
    }, [step, state?.id, state?.status, accept]);
    useEffect(() => {
        if (step !== 1 || coverMode !== 'text' || !state?.id || state.status !== 'DRAFT')
            return;
        const timer = setTimeout(() => { void api<State>('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify({ coverLetter: cover }) }).then(accept).catch(e => setNotice(e.message)); }, 650);
        return () => clearTimeout(timer);
    }, [cover, coverMode, step, state?.id, state?.status, accept]);
    const current = state?.questions?.find(q => q.answer === null);
    useEffect(() => {
        if (!current)
            return;
        if (answerQuestion.current !== current.id) {
            answerQuestion.current = current.id;
            answerRef.current = current.draft;
            setAnswer(current.draft);
            chatEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        if (!current.shownAt && tabReady && state?.status === 'ACTIVE') {
            void api<State>('/ai-screening/sessions/' + state.id + '/shown', { method: 'POST', body: JSON.stringify({ clientId: client.current, questionId: current.id }) }).then(accept).catch(e => setError(e.message));
        }
    }, [current?.id, current?.shownAt, tabReady, state?.status, state?.id, accept]);
    useEffect(() => { const clock = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(clock); }, []);
    const remaining = current?.deadlineAt ? Math.max(0, Math.ceil((Date.parse(current.deadlineAt) - now - offset.current) / 1000)) : 60;
    const saveAnswer = useCallback((value: string, questionId: string) => {
        const id = sessionRef.current?.id;
        if (!id)
            return Promise.resolve();
        const request = writing.current.catch(() => undefined).then(() => api<State>('/ai-screening/sessions/' + id + '/answer', { method: 'PATCH', body: JSON.stringify({ clientId: client.current, questionId, answer: value }) }));
        writing.current = request;
        return request;
    }, []);
    useEffect(() => {
        if (!current?.shownAt || !tabReady || state?.status !== 'ACTIVE' || remaining === 0)
            return;
        const timer = setTimeout(() => void saveAnswer(answer, current.id).catch(e => setNotice(e.message)), 450);
        return () => clearTimeout(timer);
    }, [answer, current?.id, current?.shownAt, tabReady, state?.status, saveAnswer]);
    const send = useCallback(async () => {
        const q = sessionRef.current?.questions.find(q => q.answer === null), id = sessionRef.current?.id;
        if (!q || !id || sending.current || !tabReady)
            return;
        sending.current = true;
        setBusy(true);
        setError('');
        try {
            await writing.current.catch(() => undefined);
            accept(await api<State>('/ai-screening/sessions/' + id + '/answer', { method: 'POST', body: JSON.stringify({ clientId: client.current, questionId: q.id, answer: answerRef.current }) }));
            setNotice('');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            sending.current = false;
            setBusy(false);
        }
    }, [tabReady, accept]);
    useEffect(() => {
        if (current?.deadlineAt && remaining === 0 && tabReady)
            void send();
    }, [current?.id, remaining, tabReady, send]);
    async function run(action: () => Promise<void>) {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            await action();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    async function choose(id: string) {
        setSelected(id);
        await run(async () => {
            if (state)
                accept(await api<State>('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify({ resumeId: id }) }));
        });
    }
    async function upload(file: File, kind: 'cv' | 'cover') {
        if (!/\.(pdf|docx)$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
            setError('Pilih PDF atau DOCX maksimal 5 MB, ya.');
            return;
        }
        await run(async () => {
            const body = new FormData();
            body.append('file', file);
            if (kind === 'cv') {
                body.append('parse', 'true');
                body.append('title', file.name);
                const created = await apiUpload<Cv>('/profiles/me/resumes/upload', body);
                await loadCvs();
                setSelected(created.id);
                if (state)
                    accept(await api<State>('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify({ resumeId: created.id }) }));
            }
            else if (state)
                accept(await apiUpload<State>('/ai-screening/sessions/' + state.id + '/cover-letter', body));
        });
    }
    async function next() {
        await run(async () => {
            if (!state)
                return;
            if (step === 0) {
                if (!selected)
                    throw new Error('Pilih CV terlebih dahulu, ya.');
                accept(await api<State>('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify({ resumeId: selected }) }));
            }
            if (step === 1)
                accept(await api<State>('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify(coverMode === 'text' ? { coverLetter: cover, removeCoverFile: true } : { coverLetter: '' }) }));
            if (step === 3) {
                accept(await api<State>('/ai-screening/sessions/' + state.id + '/claim', { method: 'POST', body: JSON.stringify({ clientId: client.current }) }));
                setTabReady(true);
                accept(await api<State>('/ai-screening/sessions/' + state.id + '/start', { method: 'POST', body: JSON.stringify({ clientId: client.current }) }));
            }
            else
                setStep(v => v + 1);
        });
    }
    async function finish() {
        await run(async () => {
            if (!state)
                return;
            await api('/applications/screening/' + state.id + '/submit', { method: 'POST' });
            accept(await api<State>('/ai-screening/sessions/' + state.id));
            localStorage.removeItem('tara-page:' + state.id);
        });
    }
    useEffect(() => {
        if (state?.status === 'COMPLETED' && !busy)
            void finish();
    }, [state?.status]);
    const input = (kind: 'cv' | 'cover') => <input ref={kind === 'cv' ? uploadRef : undefined} className={s.fileInput} aria-label={kind === 'cv' ? 'Unggah CV baru' : 'Unggah cover letter'} type="file" accept=".pdf,.docx" disabled={busy} onChange={e => {
            const file = e.target.files?.[0];
            if (file)
                void upload(file, kind);
            e.target.value = '';
        }}/>;
    return <section className={s.page} aria-busy={busy}>
  <header className={s.title}><h1>Melamar lowongan</h1><span>Langkah {step + 1} dari 6</span></header>
  <nav aria-label="Progres lamaran"><ol className={s.progress}>{labels.map((label, i) => <li key={label} aria-current={step === i ? 'step' : undefined} data-done={i <= step}><span />{label}</li>)}</ol></nav>
  {state?.job && <div className={s.job}><div className={s.companyMark}>{state.job.companyName.slice(0, 2).toUpperCase()}</div><div><strong>{state.job.title}</strong><p>{state.job.companyName}{state.job.city ? ' · ' + state.job.city : ''}</p></div></div>}
  {error && <div className={s.alert} role="alert">{error}{state && <button type="button" onClick={() => void run(async () => {
                    accept(await api<State>('/ai-screening/sessions/' + state.id + '/retry', { method: 'POST' }));
                    if (state.status === 'COMPLETED')
                        await finish();
                })}>Coba lanjutkan</button>}</div>}
  {notice && <p className={s.hint} role="status">{notice}</p>}
  {!state && !error && <p role="status">Menyiapkan lamaranmu…</p>}
  {state && <>
   {step === 0 && <><h2 ref={heading} tabIndex={-1}>Pilih CV andalanmu</h2><p className={s.subtitle}>Yuk, pilih CV yang paling mewakili pengalamanmu.</p><div className={s.cvGrid}><div className={s.panel}><h3>CV yang akan dikirim</h3><fieldset className={s.cvList}><legend className={s.srOnly}>Pilih CV</legend>{cvs.map(cv => <label key={cv.id} className={s.cv} data-selected={selected === cv.id}><input type="radio" name="cv" checked={selected === cv.id} disabled={busy} onChange={() => void choose(cv.id)}/><span className={s.pdf}>CV</span><span><strong>{cv.title}</strong><small>{selected === cv.id ? 'Dipilih' : 'PDF / DOCX'}</small></span></label>)}</fieldset><label className={s.upload}><span>↑</span><div><strong>Atau unggah CV baru</strong><p>PDF atau DOCX · Maks. 5 MB</p></div>{input('cv')}<span className={s.outline}>Pilih file</span></label><p className={s.hint}>ⓘ CV yang dipilih akan dikirim bersama lamaran ini.</p>{state.preparationStatus === 'FAILED' && <p className={s.alert}>{state.error ?? 'CV belum dapat diproses. Coba ganti CV atau lanjutkan kembali.'}</p>}</div><aside className={s.panel}><h3>Pratinjau CV</h3>{preview ? <><iframe className={s.preview} title="Pratinjau CV terpilih" src={preview}/><a href={preview} target="_blank" rel="noreferrer">Buka CV di tab baru ↗</a></> : <p className={s.hint}>Pilih CV untuk melihat pratinjau. Berkas DOCX dapat dibuka melalui tautan CV.</p>}</aside></div></>}
   {step === 1 && <><h2 ref={heading} tabIndex={-1}>Ceritakan sedikit tentang dirimu</h2><p className={s.subtitle}>Kenapa kamu tertarik dengan posisi ini? Tulis dengan gayamu sendiri, ya.</p><div className={s.panel}><div className={s.tabs} role="group" aria-label="Cara mengisi cover letter"><button type="button" aria-pressed={coverMode === 'text'} onClick={() => setCoverMode('text')}>Tulis langsung</button><button type="button" aria-pressed={coverMode === 'file'} onClick={() => setCoverMode('file')}>Upload file</button></div>{coverMode === 'text' ? <label className={s.letter}><strong>Cover letter <small>(opsional)</small></strong><textarea maxLength={5000} rows={7} value={cover} placeholder="Halo tim HR, saya tertarik dengan posisi ini karena…" onChange={e => setCover(e.target.value)}/></label> : <label className={s.upload}>{input('cover')}<div><strong>{state.coverFilename ?? 'Unggah cover letter (opsional)'}</strong><p>PDF atau DOCX · Maks. 5 MB</p></div><span className={s.outline}>Pilih file</span></label>}<p className={s.hint}>ⓘ Nggak harus panjang. Boleh juga dilewati.</p></div></>}
   {step === 2 && <div className={s.intro}><Image data-tara src={tara} width={480} height={480} sizes="(max-width: 760px) 260px, 440px" alt="Tara menyapa dengan ramah"/><div><span className={s.pill}>Kenalan dulu, yuk</span><h2 ref={heading} tabIndex={-1}>Hai {name}, aku Tara!</h2><p>Aku asisten AI yang akan nemeninmu ngobrol tentang pengalamanmu.</p><p>Sebelum lamaranmu terkirim, ada screening yang perlu kamu ikuti. Santai aja, jawab singkat dengan ceritamu sendiri.</p><div className={s.callout}><strong>Satu pertanyaan setiap kali. Aku temani sampai selesai!</strong><p>Jawabanmu membantu tim HR meninjau pengalaman yang kamu ceritakan di CV untuk posisi ini.</p></div></div></div>}
   {step === 3 && <><h2 ref={heading} tabIndex={-1}>Biar ngobrolnya nyaman</h2><p className={s.subtitle}>Baca sebentar, lalu kita mulai bareng Tara.</p><div className={s.rulesLayout}><div className={s.rules}>{[['◷', '1 menit per pertanyaan', 'Waktu mulai setelah pertanyaan tampil. Saat habis, draf jawaban terakhir yang tersimpan akan dikirim.'], ['✎', 'Jawab singkat aja', 'Cukup 1–3 kalimat yang menjawab pertanyaan. Ceritakan pengalamanmu sendiri.'], ['☏', 'Satu pertanyaan setiap kali', 'Kirim jawabanmu, lalu Tara akan melanjutkan. Maksimal 15 pertanyaan.'], ['⌂', 'Cari tempat yang nyaman', 'Siapkan koneksi stabil. Kalau terputus, buka lagi lamaran ini untuk melanjutkan. Timer yang sudah berjalan tetap lanjut.']].map(([icon, title, desc]) => <div className={s.rule} key={title}><span aria-hidden="true">{icon}</span><div><h3>{title}</h3><p>{desc}</p></div></div>)}</div><Image data-tara src={tara} width={480} height={480} sizes="(max-width: 760px) 260px, 440px" alt="Tara menemani membaca aturan"/></div><p className={s.relax}>Tarik napas dulu. Siap? Kita mulai pelan-pelan, ya!</p>{!state.packetReady && <p className={s.hint} role="status">{state.error ?? 'Tara sedang membaca CV dan menyiapkan pertanyaanmu. Sebentar, ya…'}</p>}</>}
   {step === 4 && <><h2 ref={heading} tabIndex={-1}>Ngobrol bersama Tara</h2><div className={s.chatIdentity}><Image data-tara src="/images/tara/avatar.png" width={48} height={60} sizes="48px" alt=""/><strong>Tara</strong><span>· Asisten screening AI</span></div><div className={s.chat}><div className={s.messages} role="log" aria-label="Percakapan dengan Tara" aria-live="polite" aria-relevant="additions">{state.questions.map(q => <div key={q.id}><div className={s.taraMessage}><Image data-tara src={tara} width={480} height={480} sizes="(max-width: 760px) 260px, 440px" alt=""/><p>{q.text}</p></div>{q.answer !== null && <div className={s.candidateMessage}><p>{q.answer || 'Waktu menjawab selesai; belum ada jawaban tersimpan.'}</p></div>}</div>)}{state.status === 'GENERATING' && <p className={s.thinking} role="status">Tara sedang menyiapkan pertanyaan berikutnya…</p>}<div ref={chatEnd}/></div>{current && state.status === 'ACTIVE' && <form className={s.composer} onSubmit={e => { e.preventDefault(); void send(); }}><div className={s.timer} role="timer" aria-label={'Sisa waktu ' + remaining + ' detik'}>◷ Waktu menjawab <strong>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</strong></div><label className={s.srOnly} htmlFor="tara-answer">Jawabanmu</label><div className={s.inputRow}><textarea id="tara-answer" maxLength={1200} rows={2} value={answer} disabled={!tabReady || !current.shownAt || remaining === 0 || busy} placeholder="Ceritakan singkat di sini…" onChange={e => { answerRef.current = e.target.value; setAnswer(e.target.value); }}/><button className={s.primary} disabled={!tabReady || !current.shownAt || busy || remaining === 0} type="submit">Kirim ↗</button></div><p className={s.hint}>{tabReady ? 'Jawab ringkas dengan pengalamanmu sendiri. Draf tersimpan otomatis.' : 'Percakapan sedang tersambung kembali…'}</p></form>}{state.status === 'COMPLETED' && <div className={s.callout}><p>Obrolan selesai! Tinggal mengirim lamaranmu.</p><button className={s.primary} disabled={busy} onClick={() => void finish()}>{busy ? 'Mengirim…' : 'Kirim lamaran'}</button></div>}</div></>}
   {step === 5 && <div className={s.success}><Image data-tara src="/images/tara/celebrate.png" width={300} height={220} sizes="300px" alt="Tara ikut senang lamaranmu terkirim"/><h2 ref={heading} tabIndex={-1}>Yeay, lamaranmu sudah terkirim!</h2><p>Makasih sudah cerita bareng Tara. Semoga segera dapat kabar baik. Semoga beruntung, {name}!</p><div className={s.receipt}><strong>{state.job.title}</strong><p>{state.job.companyName}</p><ul><li>✓ CV pilihanmu terkirim</li>{(state.coverLetter || state.coverFilename) && <li>✓ Cover letter terkirim</li>}<li>✓ Screening bersama Tara selesai</li></ul></div><p>Tim HR akan meninjau lamaran dan jawabanmu. Pantau kabarnya di Lamaran saya.</p><div className={s.actions}><a className={s.primary} href={url('/dashboard/employee?section=applications')}>Lihat lamaran saya →</a><a className={s.outline} href={url('/jobs')}>Cari lowongan lain</a></div></div>}
   {step < 4 && <footer className={s.footer}><button className={s.outline} disabled={busy} onClick={() => step ? setStep(step - 1) : window.location.assign(url('/jobs/' + jobId))}>← Kembali</button><button className={s.primary} disabled={busy || (step === 0 && !selected) || (step === 3 && !state.packetReady)} onClick={() => void next()}>{busy ? 'Menyimpan…' : step === 2 ? 'Lihat aturan singkat →' : step === 3 ? 'Siap, yuk mulai! →' : 'Lanjut →'}</button></footer>}
  </>}
 </section>;
}
