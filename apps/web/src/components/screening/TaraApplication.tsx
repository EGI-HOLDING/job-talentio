'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { api, getSession } from '@/lib/api';
import { localeUrl } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import s from './TaraApplication.module.css';
import { useScreeningFocus } from './ApplicationPresentation';
import { TaraPreparation, TaraThinking, type Preparation } from './TaraPreparation';
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
    packetReady: boolean;
    preparationStatus: string;
    preparation?: Preparation;
    conversationPolicy?: { version: string; questionSeconds: number; maxQuestions: number };
    recoveryRequired?: boolean;
    requestOrder?: number;
    serverTime: string;
    interviewDeadlineAt?: string;
    error: string | null;
    questions: Question[];
    job: {
        id: string;
        title: string;
        companyName: string;
        city: string;
    };
};
const labels = ['Kenalan', 'Aturan', 'Interview', 'Selesai'];
const tara = '/images/tara/welcome.png';
export function TaraApplication({ invitedSessionId }: { invitedSessionId: string }) {
 const uiCopy=useHrCopy();
    const { locale } = useI18n();
    const [state, setState] = useState<State | null>(null), [step, setStep] = useState(2);
    const [answer, setAnswer] = useState('');
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [now, setNow] = useState(Date.now()), [name, setName] = useState(''), [tabReady, setTabReady] = useState(false);
    const sessionRef = useRef<State | null>(null), client = useRef(''), offset = useRef(0), answerRef = useRef(''), answerQuestion = useRef(''), heading = useRef<HTMLHeadingElement>(null), chatEnd = useRef<HTMLDivElement>(null);
    const mounted = useRef(true), writing = useRef<Promise<unknown>>(Promise.resolve()), sending = useRef(false);
    const [startRequested, setStartRequested] = useState(false), [leaseNotice, setLeaseNotice] = useState('');
    const starting = useRef(false), issued = useRef(0), applied = useRef(0);
    const messages = useRef<HTMLDivElement>(null), nearBottom = useRef(true), shownRequests = useRef(new Set<string>());
    const pageRef = useRef<HTMLElement>(null);
    const questionRef = useRef<HTMLDivElement>(null), textareaRef = useRef<HTMLTextAreaElement>(null);
    const composing = useRef(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
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
        if (next.status === 'COMPLETED')
            setStep(5);
        else if (next.status !== 'DRAFT')
            setStep(4);
    }, [invitedSessionId]);
    useEffect(() => {
        let active = true;
        mounted.current = true;
        client.current = crypto.randomUUID();
        const auth = getSession();
        if (!auth) {
            window.location.assign(url('/login?next=' + encodeURIComponent(window.location.pathname + window.location.search)));
            return;
        }
        if (!['EMPLOYEE', 'SUPER_ADMIN'].includes(auth.user.role)) {
            setError('Gunakan akun kandidat penerima undangan, ya.');
            return;
        }
        setName(auth.user.fullName.split(' ')[0]);
        void (async () => {
            const next = await requestState('/ai-screening/sessions/' + invitedSessionId);
            if (!active || !mounted.current)
                return;
            accept(next);
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
                setStep(current => current === 4 ? 4 : Math.min(3, Math.max(2, saved)));
            }
        })().catch(e => { if (active) setError(e.message); });
        return () => { active = false; mounted.current = false; };
        // Locale and session are fixed for the lifetime of this route.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invitedSessionId, accept, requestState]);
    useEffect(() => {
        if (state?.id && state.status === 'DRAFT' && step < 4)
            localStorage.setItem('tara-page:' + state.id, String(step));
        heading.current?.focus();
    }, [step, state?.id, state?.status]);
    useEffect(() => {
        if (!state?.id || state.status === 'COMPLETED')
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
        if (step !== 4 || !state?.id || state.status === 'COMPLETED')
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
            setSaveStatus(current.draft ? 'saved' : 'idle');
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
    useEffect(() => { const clock = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(clock); }, []);
    const policy = state?.conversationPolicy ?? { version: 'legacy', questionSeconds: 60, maxQuestions: 15 };
    const casual = /^tara-conversation-v[45678]\./.test(policy.version);
    const remaining = current?.deadlineAt ? Math.min(policy.questionSeconds, Math.max(0, Math.ceil((Date.parse(current.deadlineAt) - now - offset.current) / 1000))) : policy.questionSeconds;
    const sessionRemaining = state?.interviewDeadlineAt ? Math.max(0, Math.ceil((Date.parse(state.interviewDeadlineAt) - now - offset.current) / 1000)) : null;
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
        const questionId = current.id, value = answer;
        const timer = setTimeout(() => {
            setSaveStatus('saving');
            void saveAnswer(value, questionId).then(() => {
                if (answerQuestion.current === questionId && answerRef.current === value) setSaveStatus('saved');
            }).catch(e => {
                if (answerQuestion.current === questionId && answerRef.current === value) { setSaveStatus('failed'); setNotice(e.message); }
            });
        }, 450);
        return () => clearTimeout(timer);
    }, [answer, current?.id, current?.shownAt, tabReady, state?.status, saveAnswer]);
    const send = useCallback(async (reason: 'manual' | 'timeout' = 'manual') => {
        const session = sessionRef.current, q = session?.questions.find(q => q.answer === null), id = session?.id;
        const value = answerRef.current;
        if (!q || !id || sending.current || !tabReady || session.status !== 'ACTIVE' || !q.shownAt) return;
        const expired = Boolean(q.deadlineAt && Date.parse(q.deadlineAt) <= Date.now() + offset.current);
        if (reason === 'manual' && (!value.trim() || expired)) return;
        sending.current = true;
        setBusy(true);
        setError('');
        try {
            await writing.current.catch(() => undefined);
            const fresh = sessionRef.current;
            if (fresh?.id !== id || fresh.status !== 'ACTIVE' || fresh.questions.find(v => v.answer === null)?.id !== q.id) return;
            const next = await requestState('/ai-screening/sessions/' + id + '/answer', { method: 'POST', body: JSON.stringify({ clientId: client.current, questionId: q.id, answer: value }) });
            nearBottom.current = true;
            accept(next);
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
            void send('timeout');
    }, [current?.id, remaining, tabReady, send]);
    const canSend = state?.status === 'ACTIVE' && tabReady && Boolean(current?.shownAt) && remaining > 0 && !busy && Boolean(answer.trim());
    useLayoutEffect(() => {
        const el = textareaRef.current;
        if (!focused || !el) return;
        const resize = () => {
            el.style.height = '0px';
            el.style.height = `${el.scrollHeight}px`;
        };
        resize();
        window.visualViewport?.addEventListener('resize', resize);
        window.addEventListener('resize', resize);
        return () => { window.visualViewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); };
    }, [answer, focused, state?.status]);
    useLayoutEffect(() => {
        const log = messages.current;
        if (!nearBottom.current || !log) return;
        // Align after the composer resizes, before scroll events can mistake layout movement for reading history.
        log.scrollTop = log.scrollHeight;
    }, [answer, focused, state?.questions.length, state?.status, current?.id]);
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
    async function next() {
        await run(async () => {
            if (!state) return;
            if (step === 3) {
                try { sessionStorage.setItem('tara-start-intent:' + state.id, 'true'); } catch { /* In-memory fallback. */ }
                setStartRequested(true); setStep(4); await attemptStart();
            } else setStep(3);
        });
    }
    const contactHr = () => window.location.assign(url('/messages'));
    async function retry() {
        if (state?.status === 'COMPLETED') { setError(''); setStep(5); return; }
        await run(async () => {
            if (!state) return;
            accept(await requestState('/ai-screening/sessions/' + state.id + '/retry', { method: 'POST' }));
        });
        if (startRequested && sessionRef.current?.status === 'DRAFT' && sessionRef.current.preparation?.status === 'READY') await attemptStart();
    }
    return <section ref={pageRef} className={`${s.page} ${focused ? s.focusPage : ""}`} aria-busy={busy} data-tara-focus={focused || undefined}>
  {!focused && <header className={s.title}><h1>{uiCopy("Interview bersama Tara")}</h1><span>Langkah {step - 1} dari 4</span></header>}
  <nav aria-label={uiCopy("Progres interview")}><ol className={s.progress}>{labels.map((label, i) => <li key={label} aria-current={(step - 2) === i ? 'step' : undefined} data-done={i <= (step - 2)}><span aria-hidden="true">{focused && i < (step - 2) ? <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg> : null}</span><span className={s.stepLabel}>{label}</span></li>)}</ol></nav>
  {!focused && state?.job && <div className={s.job}><div className={s.companyMark}>{state.job.companyName.slice(0, 2).toUpperCase()}</div><div><strong>{state.job.title}</strong><p>{state.job.companyName}{state.job.city ? ' \u00b7 ' + state.job.city : ''}</p></div></div>}
  {error && <div className={s.alert} role="alert">{error}{state && !state.recoveryRequired && !['RECOVERY_REQUIRED', 'CV_UNREADABLE'].includes(preparation.reason ?? '') && <button type="button" disabled={busy} onClick={() => void retry()}>{uiCopy("Coba lanjutkan")}</button>}</div>}
  {(notice || leaseNotice) && <p className={s.hint} role="status">{leaseNotice || notice}</p>}
  {!state && !error && <p role="status">Menyiapkan interview&#x2026;</p>}
  {state && <>
   {step === 2 && <div className={s.intro}><Image data-tara src={tara} width={480} height={480} sizes="(max-width: 760px) 260px, 440px" alt="Tara menyapa dengan ramah"/><div><span className={s.pill}>Kenalan dulu, yuk</span><h2 ref={heading} tabIndex={-1}>Hai {name}, {casual ? 'gue' : 'aku'} Tara!</h2><p>{casual ? 'Gue asisten AI yang bakal nemenin lu ngobrol soal pengalaman di CV lu.' : 'Aku asisten AI yang akan nemeninmu ngobrol tentang pengalamanmu.'}</p><p>{casual ? 'Tim HR mengundang lu buat cerita soal pengalaman di CV dan posisi ini. Santai, ceritain yang lu kerjain dengan bahasa lu sendiri.' : 'Tim HR mengundangmu untuk screening awal. Santai aja, jawab singkat dengan ceritamu sendiri.'}</p><div className={s.callout}><strong>{casual ? 'Satu pertanyaan dulu. Gue temenin sampai beres!' : 'Satu pertanyaan setiap kali. Aku temani sampai selesai!'}</strong><p>Jawabanmu membantu tim HR meninjau pengalaman yang kamu ceritakan di CV untuk posisi ini.</p></div></div></div>}
   {step === 3 && <><h2 ref={heading} tabIndex={-1}>{uiCopy("Biar ngobrolnya nyaman")}</h2><p className={s.subtitle}>Baca sebentar, lalu kita mulai bareng Tara.</p><div className={s.rulesLayout}><div className={s.rules}>{[['◷', `${policy.questionSeconds < 60 ? policy.questionSeconds + ' detik' : policy.questionSeconds / 60 + ' menit'} per pertanyaan`, 'Waktu mulai setelah pertanyaan tampil. Saat habis, draf jawaban terakhir yang tersimpan akan dikirim.'], ['✎', 'Jawab singkat aja', `Cukup ${casual ? '1\u20132' : '1\u20133'} kalimat yang menjawab pertanyaan. Ceritakan pengalamanmu sendiri.`], ['☏', 'Satu pertanyaan setiap kali', `Kirim jawabanmu, lalu Tara akan melanjutkan. Maksimal ${policy.maxQuestions} pertanyaan.`], ['⌂', 'Cari tempat yang nyaman', 'Siapkan koneksi stabil. Kalau terputus, buka lagi undangan ini untuk melanjutkan. Timer yang sudah berjalan tetap lanjut.']].map(([icon, title, desc]) => <div className={s.rule} key={title}><span aria-hidden="true">{icon}</span><div><h3>{title}</h3><p>{desc}</p></div></div>)}</div><Image data-tara src={tara} width={480} height={480} sizes="(max-width: 760px) 260px, 440px" alt="Tara menemani membaca aturan"/></div><p className={s.relax}>Tarik napas dulu. Siap? Kita mulai pelan-pelan, ya!</p></>}
   {step > 0 && step < 4 && <TaraPreparation invited casual={casual} preparation={preparation} rules={step === 3} onRetry={() => void retry()} onChangeCv={contactHr} busy={busy}/>}
   {step === 4 && <>
    <h2 className={s.srOnly} ref={heading} tabIndex={-1}>{uiCopy("Interview bersama Tara")}</h2>
    {state.status === 'DRAFT' ? <TaraPreparation invited casual={casual} preparation={preparation} variant="waiting" onRetry={() => void retry()} onChangeCv={contactHr} busy={busy}/> : <div className={s.focusChat}>
     <div className={s.chatIdentity}><Image data-tara src="/images/tara/avatar.png" width={56} height={56} alt=""/><div><strong>Tara</strong><span>{uiCopy("Asisten screening AI")}</span>{sessionRemaining!==null&&state.status!=='COMPLETED'&&<span role="timer">Sisa sesi {Math.floor(sessionRemaining/60)}:{String(sessionRemaining%60).padStart(2,'0')}</span>}</div></div>
     <div ref={messages} className={s.messages} onScroll={() => { const el = messages.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} role="log" aria-label={uiCopy("Percakapan dengan Tara")} aria-live="polite" aria-relevant="additions">
      {state.questions.map(q => <div key={q.id}><div ref={q.id === current?.id ? questionRef : undefined} className={s.taraMessage}><Image data-tara src="/images/tara/avatar.png" width={48} height={48} alt=""/><p>{q.text}</p></div>{q.answer !== null && <div className={s.candidateMessage}><p>{q.answer || 'Waktu menjawab selesai; belum ada jawaban tersimpan.'}</p></div>}</div>)}
      {state.status === 'GENERATING' && (state.error ? <div className={s.callout} role="status"><p>{state.error}</p>{state.recoveryRequired ? <p>Progresmu tersimpan. Tim kami perlu memeriksa sambungannya; kamu bisa kembali lagi nanti.</p> : <button className={s.primary} disabled={busy} onClick={() => void retry()}>{uiCopy("Coba lagi")}</button>}</div> : <TaraThinking casual={casual}/>)}
      {state.status === 'COMPLETED' && <div className={s.callout} role="status"><p>{'Percakapan selesai. Jawabanmu sudah tersimpan.'}</p></div>}
      <div ref={chatEnd}/>
     </div>
     <form className={s.composer} onSubmit={e => { e.preventDefault(); if (canSend) void send('manual'); }}>
      {current?.shownAt && state.status === 'ACTIVE' && <div className={s.timer} role="timer" aria-label={'Sisa waktu ' + remaining + ' detik'}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>{uiCopy("Waktu menjawab")}</span><strong>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</strong></div>}
      <label className={s.srOnly} htmlFor="tara-answer">Jawabanmu</label>
      <div className={s.answerBox} data-disabled={state.status !== 'ACTIVE' || !tabReady || !current?.shownAt || remaining === 0 || busy}>
       <textarea ref={textareaRef} id="tara-answer" maxLength={1200} rows={2} value={state.status === 'ACTIVE' ? answer : ''} disabled={state.status !== 'ACTIVE' || !tabReady || !current?.shownAt || remaining === 0 || busy} placeholder={state.status === 'ACTIVE' ? 'Ceritakan singkat di sini\u2026' : state.status === 'COMPLETED' ? 'Obrolanmu sudah selesai.' : 'Tunggu pertanyaan Tara berikutnya, ya\u2026'} onFocus={() => { nearBottom.current = true; }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => {
           if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
           e.preventDefault();
           if (!e.repeat && canSend) void send('manual');
       }} onChange={e => { answerRef.current = e.target.value; setAnswer(e.target.value); setSaveStatus('idle'); }}/>
       <button className={s.sendButton} disabled={!canSend} type="submit" aria-label={uiCopy("Kirim jawaban")} title={uiCopy("Kirim jawaban")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7"/></svg></button>
      </div>
      <div className={s.composerHelp}>
       <span className={s.keyboardHint}><kbd>Enter</kbd> untuk kirim <span aria-hidden="true">&#xb7;</span> <kbd>Shift + Enter</kbd> untuk baris baru</span>
       <span className={s.saveStatus} role="status">{state.status === 'ACTIVE' ? !tabReady ? 'Menyambungkan kembali\u2026' : saveStatus === 'saved' ? '✓ Draf tersimpan otomatis' : saveStatus === 'saving' ? 'Menyimpan draf\u2026' : saveStatus === 'failed' ? 'Draf belum tersimpan. Periksa koneksi.' : answer ? 'Perubahan belum tersimpan' : '' : ''}</span>
      </div>
     </form>
    </div>}
   </>}
   {step === 5 && <div className={s.success}><Image data-tara src="/images/tara/celebrate.png" width={300} height={220} sizes="300px" alt="Tara merayakan selesainya interview"/><h2 ref={heading} tabIndex={-1}>Interview selesai. Makasih sudah cerita!</h2><p>{casual ? 'Makasih udah cerita bareng gue. Semoga kabar baik segera mampir, ' + name + '!' : 'Makasih sudah cerita bareng Tara. Semoga segera dapat kabar baik. Semoga beruntung, ' + name + '!'}</p><div className={s.receipt}><strong>{state.job.title}</strong><p>{state.job.companyName}</p><ul><li>✓ Screening bersama Tara selesai</li></ul></div><p>Jawabanmu sudah tersimpan dan akan ditinjau tim HR. Pantau kabar selanjutnya melalui Pesan Talentio.</p><div className={s.actions}><a className={s.primary} href={url('/messages')}>Buka Pesan Talentio →</a><a className={s.outline} href={url('/jobs')}>{uiCopy("Cari lowongan lain")}</a></div></div>}
   {step < 4 && <footer className={s.footer}><button className={s.outline} disabled={busy} onClick={() => step > 2 ? setStep(step - 1) : window.location.assign(url('/messages'))}>← Kembali</button><button className={s.primary} disabled={busy} onClick={() => void next()}>{busy ? 'Menyimpan\u2026' : step === 2 ? 'Lihat aturan singkat →' : step === 3 ? 'Siap, yuk mulai! →' : 'Lanjut →'}</button></footer>}
  </>}
 </section>;
}
