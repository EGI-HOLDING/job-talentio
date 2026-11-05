'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { api, apiUpload, getSession } from '@/lib/api';
import { localeUrl } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { jobAttribution, trackJobEvent } from '@/lib/hr-events';
import { rememberSource, readSource } from '@/lib/acquisition';
import s from './TaraApplication.module.css';
import { useScreeningFocus } from './ApplicationPresentation';
import { TaraPreparation, TaraThinking, type Preparation } from './TaraPreparation';
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
    preparation?: Preparation;
    recoveryRequired?: boolean;
    requestOrder?: number;
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
    const [startRequested, setStartRequested] = useState(false), [leaseNotice, setLeaseNotice] = useState('');
    const starting = useRef(false), finishing = useRef(false), issued = useRef(0), applied = useRef(0), cvSelection = useRef('');
    const messages = useRef<HTMLDivElement>(null), nearBottom = useRef(true), shownRequests = useRef(new Set<string>());
    const pageRef = useRef<HTMLElement>(null);
    const questionRef = useRef<HTMLDivElement>(null);
    const focused = step === 4;
    useScreeningFocus(focused);
    useEffect(() => {
        if (!focused || !window.visualViewport) return;
        const viewport = window.visualViewport;
        const resize = () => pageRef.current?.style.setProperty('--tara-viewport-height', `${viewport.height}px`);
        resize();
        viewport.addEventListener('resize', resize);
        return () => { viewport.removeEventListener('resize', resize); pageRef.current?.style.removeProperty('--tara-viewport-height'); };
    }, [focused]);
    const requestState = useCallback(async (path: string, options?: RequestInit) => {
        const requestOrder = ++issued.current;
        return { ...await api<State>(path, options), requestOrder };
    }, []);
    const url = (path: string) => localeUrl(locale, path);
    const accept = useCallback((next: State) => {
        if (!mounted.current)
            return;
        const previous = sessionRef.current;
        if (next.status === 'DRAFT' && cvSelection.current && next.resumeId && next.resumeId !== cvSelection.current) return;
        if (previous && previous.id === next.id) {
            if (next.revision < previous.revision)
                return;
            if (next.revision === previous.revision && (next.requestOrder ?? 0) < applied.current) return;
            const order: Record<string, number> = { DRAFT: 0, ACTIVE: 1, GENERATING: 1, COMPLETED: 2, SUBMITTED: 3 };
            if (previous.revision === next.revision && order[next.status] < order[previous.status])
                return;
        }
        if (next.serverTime)
            offset.current = Date.parse(next.serverTime) - Date.now();
        sessionRef.current = next;
        applied.current = Math.max(applied.current, next.requestOrder ?? 0);
        setState(next);
        if (next.status !== 'DRAFT') {
            setStartRequested(false);
            try { sessionStorage.removeItem('tara-start-intent:' + next.id); } catch { /* Storage may be unavailable. */ }
        }
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
        let active = true;
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
            const [next, list] = await Promise.all([requestState('/ai-screening/jobs/' + jobId + '/draft', { method: 'POST' }), loadCvs()]);
            if (!active || !mounted.current)
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
            cvSelection.current = resume;
            try {
                const reloading = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';
                const clientKey = 'tara-client:' + next.id;
                if (reloading) client.current = sessionStorage.getItem(clientKey) || client.current;
                sessionStorage.setItem(clientKey, client.current);
                if (!reloading) sessionStorage.removeItem('tara-start-intent:' + next.id);
                if (next.status === 'DRAFT' && reloading && sessionStorage.getItem('tara-start-intent:' + next.id)) {
                    setStartRequested(true);
                    setStep(4);
                }
            } catch { /* The in-memory flow still works without storage. */ }
            if (next.status === 'DRAFT') {
                const saved = Number(localStorage.getItem('tara-page:' + next.id) || 0);
                setStep(current => current === 4 ? 4 : Math.min(3, Math.max(0, saved)));
                accept(await requestState('/ai-screening/sessions/' + next.id, { method: 'PATCH', body: JSON.stringify({ resumeId: !next.resumeId && resume ? resume : undefined, source: readSource(jobId) }) }));
                void jobAttribution(jobId).then(token => token ? api('/ai-screening/sessions/' + next.id, { method: 'PATCH', body: JSON.stringify({ funnelSession: token }) }) : undefined).catch(() => undefined);
            }
        })().catch(e => { if (active) setError(e.message); });
        return () => { active = false; mounted.current = false; };
        // Locale and job are fixed for the lifetime of this route.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobId, accept, loadCvs]);
    useEffect(() => {
        if (state?.id && state.status === 'DRAFT' && step < 4)
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
        let polling = false;
        const poll = setInterval(() => {
            if (polling) return;
            polling = true;
            void requestState('/ai-screening/sessions/' + state.id).then(next => { accept(next); setNotice(''); }).catch(() => setNotice('Koneksi terputus sebentar. Progresmu tersimpan, ya.')).finally(() => { polling = false; });
        }, 2500);
        return () => clearInterval(poll);
    }, [state?.id, state?.status, accept]);
    useEffect(() => {
        if (step !== 4 || !state?.id || state.status === 'SUBMITTED')
            return;
        let active = true;
        const claim = () => requestState('/ai-screening/sessions/' + state.id + '/claim', { method: 'POST', body: JSON.stringify({ clientId: client.current }) }).then(next => {
            if (active) {
                setTabReady(true);
                setLeaseNotice('');
                accept(next);
            }
        }).catch(e => {
            if (active) {
                setTabReady(false);
                setLeaseNotice(e.message);
            }
        });
        void claim();
        const heartbeat = setInterval(() => void claim(), 8000);
        return () => { active = false; clearInterval(heartbeat); };
    }, [step, state?.id, state?.status, accept]);
    useEffect(() => {
        if (step !== 1 || coverMode !== 'text' || !state?.id || state.status !== 'DRAFT')
            return;
        const timer = setTimeout(() => { void requestState('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify({ coverLetter: cover }) }).then(accept).catch(e => setNotice(e.message)); }, 650);
        return () => clearTimeout(timer);
    }, [cover, coverMode, step, state?.id, state?.status, accept]);
    const current = state?.questions?.find(q => q.answer === null);
    const preparation: Preparation = state?.preparation ?? { status: state?.packetReady ? 'READY' : state?.preparationStatus === 'FAILED' ? 'FAILED' : state?.resumeId ? 'PROCESSING' : 'WAITING_CV', planId: null, reason: null };
    const attemptStart = useCallback(async () => {
        const row = sessionRef.current;
        if (!row || row.status !== 'DRAFT' || starting.current) return;
        starting.current = true;
        try {
            const claimed = await requestState('/ai-screening/sessions/' + row.id + '/claim', { method: 'POST', body: JSON.stringify({ clientId: client.current }) });
            accept(claimed);
            setTabReady(true);
            setLeaseNotice('');
            accept(await requestState('/ai-screening/sessions/' + row.id + '/start', { method: 'POST', body: JSON.stringify({ clientId: client.current }) }));
        } catch (e) { setError((e as Error).message); }
        finally { starting.current = false; }
    }, [requestState, accept]);
    useEffect(() => {
        if (startRequested && step === 4 && state?.status === 'DRAFT' && preparation.status === 'READY' && tabReady && !error && !busy)
            void attemptStart();
    }, [startRequested, step, state?.status, preparation.status, preparation.planId, tabReady, error, busy, attemptStart]);
    useEffect(() => {
        if (!current)
            return;
        if (answerQuestion.current !== current.id) {
            answerQuestion.current = current.id;
            answerRef.current = current.draft;
            setAnswer(current.draft);
        }
        if (step === 4 && !current.shownAt && tabReady && state?.status === 'ACTIVE' && !shownRequests.current.has(current.id)) {
            const frame = requestAnimationFrame(() => {
                if (document.visibilityState !== 'visible') return;
                const question = questionRef.current?.getBoundingClientRect(), viewport = messages.current?.getBoundingClientRect();
                if (!question || !viewport) return;
                const visible = Math.min(question.bottom, viewport.bottom) - Math.max(question.top, viewport.top);
                // Reading older messages must not consume time for an unseen question.
                if (visible < Math.min(question.height, viewport.height) * .8) return;
                shownRequests.current.add(current.id);
                void requestState('/ai-screening/sessions/' + state.id + '/shown', { method: 'POST', body: JSON.stringify({ clientId: client.current, questionId: current.id }) }).then(accept).catch(e => { shownRequests.current.delete(current.id); setError(e.message); });
            });
            return () => cancelAnimationFrame(frame);
        }
    }, [step, current?.id, current?.shownAt, tabReady, state?.status, state?.id, accept, now, requestState]);
    useEffect(() => {
        if (!nearBottom.current || !messages.current) return;
        messages.current.scrollTo({ top: messages.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, [state?.questions.length, state?.status, current?.id]);
    useEffect(() => { const clock = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(clock); }, []);
    const remaining = current?.deadlineAt ? Math.max(0, Math.ceil((Date.parse(current.deadlineAt) - now - offset.current) / 1000)) : 60;
    const saveAnswer = useCallback((value: string, questionId: string) => {
        const id = sessionRef.current?.id;
        if (!id)
            return Promise.resolve();
        const request = writing.current.catch(() => undefined).then(() => requestState('/ai-screening/sessions/' + id + '/answer', { method: 'PATCH', body: JSON.stringify({ clientId: client.current, questionId, answer: value }) }));
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
            accept(await requestState('/ai-screening/sessions/' + id + '/answer', { method: 'POST', body: JSON.stringify({ clientId: client.current, questionId: q.id, answer: answerRef.current }) }));
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
        changeCv(false);
        cvSelection.current = id;
        setSelected(id);
        await run(async () => {
            if (state)
                accept(await requestState('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify({ resumeId: id }) }));
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
                changeCv(false);
                body.append('parse', 'true');
                body.append('title', file.name);
                const created = await apiUpload<Cv>('/profiles/me/resumes/upload', body);
                await loadCvs();
                setSelected(created.id);
                cvSelection.current = created.id;
                if (state)
                    accept(await requestState('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify({ resumeId: created.id }) }));
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
                accept(await requestState('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify({ resumeId: selected }) }));
            }
            if (step === 1)
                accept(await requestState('/ai-screening/sessions/' + state.id, { method: 'PATCH', body: JSON.stringify(coverMode === 'text' ? { coverLetter: cover, removeCoverFile: true } : { coverLetter: '' }) }));
            if (step === 3) {
                try { sessionStorage.setItem('tara-start-intent:' + state.id, 'true'); } catch { /* In-memory fallback. */ }
                setStartRequested(true);
                setStep(4);
                await attemptStart();
            }
            else
                setStep(v => v + 1);
        });
    }
    async function finish() {
        if (finishing.current) return;
        finishing.current = true;
        try {
        await run(async () => {
            if (!state)
                return;
            await api('/applications/screening/' + state.id + '/submit', { method: 'POST' });
            accept(await requestState('/ai-screening/sessions/' + state.id));
            localStorage.removeItem('tara-page:' + state.id);
        });
        } finally { finishing.current = false; }
    }
    useEffect(() => {
        if (state?.status === 'COMPLETED' && !busy && !error)
            void finish();
    }, [state?.status, busy, error]);
    function changeCv(goBack = true) {
        setStartRequested(false);
        setError('');
        setLeaseNotice('');
        if (state) try { sessionStorage.removeItem('tara-start-intent:' + state.id); } catch { /* In-memory fallback. */ }
        if (goBack) setStep(0);
    }
    async function retry() {
        if (state?.status === 'COMPLETED') { setError(''); await finish(); return; }
        await run(async () => {
            if (!state) return;
            accept(await requestState('/ai-screening/sessions/' + state.id + '/retry', { method: 'POST' }));
        });
        if (startRequested && sessionRef.current?.status === 'DRAFT' && sessionRef.current.preparation?.status === 'READY') await attemptStart();
    }
    const input = (kind: 'cv' | 'cover') => <input ref={kind === 'cv' ? uploadRef : undefined} className={s.fileInput} aria-label={kind === 'cv' ? 'Unggah CV baru' : 'Unggah cover letter'} type="file" accept=".pdf,.docx" disabled={busy} onChange={e => {
            const file = e.target.files?.[0];
            if (file)
                void upload(file, kind);
            e.target.value = '';
        }}/>;
    return <section ref={pageRef} className={`${s.page} ${focused ? s.focusPage : ""}`} aria-busy={busy} data-tara-focus={focused || undefined}>
  {!focused && <header className={s.title}><h1>Melamar lowongan</h1><span>Langkah {step + 1} dari 6</span></header>}
  <nav aria-label="Progres lamaran"><ol className={s.progress}>{labels.map((label, i) => <li key={label} aria-current={step === i ? 'step' : undefined} data-done={i <= step}><span />{label}</li>)}</ol></nav>
  {!focused && state?.job && <div className={s.job}><div className={s.companyMark}>{state.job.companyName.slice(0, 2).toUpperCase()}</div><div><strong>{state.job.title}</strong><p>{state.job.companyName}{state.job.city ? ' · ' + state.job.city : ''}</p></div></div>}
  {error && <div className={s.alert} role="alert">{error}{state && !state.recoveryRequired && !['RECOVERY_REQUIRED', 'CV_UNREADABLE'].includes(preparation.reason ?? '') && <button type="button" disabled={busy} onClick={() => void retry()}>Coba lanjutkan</button>}</div>}
  {(notice || leaseNotice) && <p className={s.hint} role="status">{leaseNotice || notice}</p>}
  {!state && !error && <p role="status">Menyiapkan lamaranmu…</p>}
  {state && <>
   {step === 0 && <><h2 ref={heading} tabIndex={-1}>Pilih CV andalanmu</h2><p className={s.subtitle}>Yuk, pilih CV yang paling mewakili pengalamanmu.</p><div className={s.cvGrid}><div className={s.panel}><h3>CV yang akan dikirim</h3><fieldset className={s.cvList}><legend className={s.srOnly}>Pilih CV</legend>{cvs.map(cv => <label key={cv.id} className={s.cv} data-selected={selected === cv.id}><input type="radio" name="cv" checked={selected === cv.id} disabled={busy} onChange={() => void choose(cv.id)}/><span className={s.pdf}>CV</span><span><strong>{cv.title}</strong><small>{selected === cv.id ? 'Dipilih' : 'PDF / DOCX'}</small></span></label>)}</fieldset><label className={s.upload}><span>↑</span><div><strong>Atau unggah CV baru</strong><p>PDF atau DOCX · Maks. 5 MB</p></div>{input('cv')}<span className={s.outline}>Pilih file</span></label><p className={s.hint}>ⓘ CV yang dipilih akan dikirim bersama lamaran ini.</p>{state.preparationStatus === 'FAILED' && <p className={s.alert}>{state.error ?? 'CV belum dapat diproses. Coba ganti CV atau lanjutkan kembali.'}</p>}</div><aside className={s.panel}><h3>Pratinjau CV</h3>{preview ? <><iframe className={s.preview} title="Pratinjau CV terpilih" src={preview}/><a href={preview} target="_blank" rel="noreferrer">Buka CV di tab baru ↗</a></> : <p className={s.hint}>Pilih CV untuk melihat pratinjau. Berkas DOCX dapat dibuka melalui tautan CV.</p>}</aside></div></>}
   {step === 1 && <><h2 ref={heading} tabIndex={-1}>Ceritakan sedikit tentang dirimu</h2><p className={s.subtitle}>Kenapa kamu tertarik dengan posisi ini? Tulis dengan gayamu sendiri, ya.</p><div className={s.panel}><div className={s.tabs} role="group" aria-label="Cara mengisi cover letter"><button type="button" aria-pressed={coverMode === 'text'} onClick={() => setCoverMode('text')}>Tulis langsung</button><button type="button" aria-pressed={coverMode === 'file'} onClick={() => setCoverMode('file')}>Upload file</button></div>{coverMode === 'text' ? <label className={s.letter}><strong>Cover letter <small>(opsional)</small></strong><textarea maxLength={5000} rows={7} value={cover} placeholder="Halo tim HR, saya tertarik dengan posisi ini karena…" onChange={e => setCover(e.target.value)}/></label> : <label className={s.upload}>{input('cover')}<div><strong>{state.coverFilename ?? 'Unggah cover letter (opsional)'}</strong><p>PDF atau DOCX · Maks. 5 MB</p></div><span className={s.outline}>Pilih file</span></label>}<p className={s.hint}>ⓘ Nggak harus panjang. Boleh juga dilewati.</p></div></>}
   {step === 2 && <div className={s.intro}><Image data-tara src={tara} width={480} height={480} sizes="(max-width: 760px) 260px, 440px" alt="Tara menyapa dengan ramah"/><div><span className={s.pill}>Kenalan dulu, yuk</span><h2 ref={heading} tabIndex={-1}>Hai {name}, aku Tara!</h2><p>Aku asisten AI yang akan nemeninmu ngobrol tentang pengalamanmu.</p><p>Sebelum lamaranmu terkirim, ada screening yang perlu kamu ikuti. Santai aja, jawab singkat dengan ceritamu sendiri.</p><div className={s.callout}><strong>Satu pertanyaan setiap kali. Aku temani sampai selesai!</strong><p>Jawabanmu membantu tim HR meninjau pengalaman yang kamu ceritakan di CV untuk posisi ini.</p></div></div></div>}
   {step === 3 && <><h2 ref={heading} tabIndex={-1}>Biar ngobrolnya nyaman</h2><p className={s.subtitle}>Baca sebentar, lalu kita mulai bareng Tara.</p><div className={s.rulesLayout}><div className={s.rules}>{[['◷', '1 menit per pertanyaan', 'Waktu mulai setelah pertanyaan tampil. Saat habis, draf jawaban terakhir yang tersimpan akan dikirim.'], ['✎', 'Jawab singkat aja', 'Cukup 1–3 kalimat yang menjawab pertanyaan. Ceritakan pengalamanmu sendiri.'], ['☏', 'Satu pertanyaan setiap kali', 'Kirim jawabanmu, lalu Tara akan melanjutkan. Maksimal 15 pertanyaan.'], ['⌂', 'Cari tempat yang nyaman', 'Siapkan koneksi stabil. Kalau terputus, buka lagi lamaran ini untuk melanjutkan. Timer yang sudah berjalan tetap lanjut.']].map(([icon, title, desc]) => <div className={s.rule} key={title}><span aria-hidden="true">{icon}</span><div><h3>{title}</h3><p>{desc}</p></div></div>)}</div><Image data-tara src={tara} width={480} height={480} sizes="(max-width: 760px) 260px, 440px" alt="Tara menemani membaca aturan"/></div><p className={s.relax}>Tarik napas dulu. Siap? Kita mulai pelan-pelan, ya!</p></>}
   {step > 0 && step < 4 && <TaraPreparation preparation={preparation} rules={step === 3} onRetry={() => void retry()} onChangeCv={() => changeCv()} busy={busy}/>}
   {step === 4 && <>
    <h2 className={s.srOnly} ref={heading} tabIndex={-1}>Ngobrol bersama Tara</h2>
    {state.status === 'DRAFT' ? <TaraPreparation preparation={preparation} variant="waiting" onRetry={() => void retry()} onChangeCv={() => changeCv()} busy={busy}/> : <div className={s.focusChat}>
     <div className={s.chatIdentity}><Image data-tara src="/images/tara/avatar.png" width={56} height={56} alt=""/><div><strong>Tara</strong><span>Asisten screening AI</span></div></div>
     <div ref={messages} className={s.messages} onScroll={() => { const el = messages.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} role="log" aria-label="Percakapan dengan Tara" aria-live="polite" aria-relevant="additions">
      {state.questions.map(q => <div key={q.id}><div ref={q.id === current?.id ? questionRef : undefined} className={s.taraMessage}><Image data-tara src="/images/tara/avatar.png" width={48} height={48} alt=""/><p>{q.text}</p></div>{q.answer !== null && <div className={s.candidateMessage}><p>{q.answer || 'Waktu menjawab selesai; belum ada jawaban tersimpan.'}</p></div>}</div>)}
      {state.status === 'GENERATING' && (state.error ? <div className={s.callout} role="status"><p>{state.error}</p>{state.recoveryRequired ? <p>Progresmu tersimpan. Tim kami perlu memeriksa sambungannya; kamu bisa kembali lagi nanti.</p> : <button className={s.primary} disabled={busy} onClick={() => void retry()}>Coba lagi</button>}</div> : <TaraThinking/>)}
      {state.status === 'COMPLETED' && <div className={s.callout} role="status"><p>{busy ? 'Mengirim lamaranmu…' : error ? 'Progresmu tersimpan. Coba kirim kembali, ya.' : 'Obrolan selesai! Menyiapkan pengiriman lamaranmu…'}</p></div>}
      <div ref={chatEnd}/>
     </div>
     <form className={s.composer} onSubmit={e => { e.preventDefault(); if (state.status === 'ACTIVE') void send(); }}>
      {current?.shownAt && state.status === 'ACTIVE' && <div className={s.timer} role="timer" aria-label={'Sisa waktu ' + remaining + ' detik'}>◷ Waktu menjawab <strong>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</strong></div>}
      <label className={s.srOnly} htmlFor="tara-answer">Jawabanmu</label><div className={s.inputRow}>
       <textarea id="tara-answer" maxLength={1200} rows={2} value={state.status === 'ACTIVE' ? answer : ''} disabled={state.status !== 'ACTIVE' || !tabReady || !current?.shownAt || remaining === 0 || busy} placeholder={state.status === 'ACTIVE' ? 'Ceritakan singkat di sini…' : state.status === 'COMPLETED' ? 'Obrolanmu sudah selesai.' : 'Tunggu pertanyaan Tara berikutnya, ya…'} onFocus={() => { nearBottom.current = true; }} onChange={e => { answerRef.current = e.target.value; setAnswer(e.target.value); }}/>
       <button className={s.primary} disabled={state.status !== 'ACTIVE' || !tabReady || !current?.shownAt || busy || remaining === 0} type="submit">Kirim ↗</button>
      </div>
      {state.status === 'ACTIVE' && <p className={s.hint}>{tabReady ? 'Jawab ringkas dengan pengalamanmu sendiri. Draf tersimpan otomatis.' : 'Percakapan sedang tersambung kembali…'}</p>}
     </form>
    </div>}
   </>}
   {step === 5 && <div className={s.success}><Image data-tara src="/images/tara/celebrate.png" width={300} height={220} sizes="300px" alt="Tara ikut senang lamaranmu terkirim"/><h2 ref={heading} tabIndex={-1}>Yeay, lamaranmu sudah terkirim!</h2><p>Makasih sudah cerita bareng Tara. Semoga segera dapat kabar baik. Semoga beruntung, {name}!</p><div className={s.receipt}><strong>{state.job.title}</strong><p>{state.job.companyName}</p><ul><li>✓ CV pilihanmu terkirim</li>{(state.coverLetter || state.coverFilename) && <li>✓ Cover letter terkirim</li>}<li>✓ Screening bersama Tara selesai</li></ul></div><p>Tim HR akan meninjau lamaran dan jawabanmu. Pantau kabarnya di Lamaran saya.</p><div className={s.actions}><a className={s.primary} href={url('/dashboard/employee?section=applications')}>Lihat lamaran saya →</a><a className={s.outline} href={url('/jobs')}>Cari lowongan lain</a></div></div>}
   {step < 4 && <footer className={s.footer}><button className={s.outline} disabled={busy} onClick={() => step ? setStep(step - 1) : window.location.assign(url('/jobs/' + jobId))}>← Kembali</button><button className={s.primary} disabled={busy || (step === 0 && !selected)} onClick={() => void next()}>{busy ? 'Menyimpan…' : step === 2 ? 'Lihat aturan singkat →' : step === 3 ? 'Siap, yuk mulai! →' : 'Lanjut →'}</button></footer>}
  </>}
 </section>;
}
