'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';
import { HrSupport } from './HrSupport';
import { allowEmployerContextChange } from './useEmployerUnsaved';
import { useHrAssistantSurface } from './HrFlowPresentation';
import { assistantScenes, saveAssistantProgress, type AssistantSceneId } from './hrAssistantState';
import s from './HrAssistantOnboarding.module.css';

const asset = (name: string) => `/images/hr-onboarding/generated/${name}.${name.startsWith('tara-chat-') || name.startsWith('candidate-') ? 'browser.png' : 'webp'}`;
const preload = ['taka-wave', 'taka-collect', 'taka-ranking', 'taka-proud', 'tara-wave', 'taka-chat', 'taka-interview', 'taka-upload', 'tara-chat-header', 'tara-chat-thinking', 'tara-chat-notes', 'tara-interviewer', 'candidate-chat', 'candidate-1', 'candidate-2', 'candidate-3', 'cv-sheet', 'cv-stack', 'talentio-tray', 'arrow-left', 'arrow-right', 'upload-cloud'];

function Arrow({ back = false }: { back?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 28 24"><path d={back ? 'M25 12H3m9-9-9 9 9 9' : 'M3 12h22m-9-9 9 9-9 9'} /></svg>;
}
function Microphone() {
  return <svg aria-hidden="true" viewBox="0 0 30 36"><rect x="9" y="2" width="12" height="21" rx="6" /><path d="M3 16v3a12 12 0 0 0 24 0v-3M15 31v4M9 35h12" /></svg>;
}
function Art({ name, className = '', alt = '', style }: { name: string; className?: string; alt?: string; style?: CSSProperties }) {
  return <img src={asset(name)} alt={alt} draggable={false} className={`${s.art} ${className}`} style={style} />;
}
function Bubble({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`${s.bubble} ${className}`} style={style}>{children}</div>;
}

/** The normal site navigation switches to this compact header only during the story. */
export function HrAssistantHeader({ companyId, companyName }: { companyId: string; companyName: string }) {
  const c = useHrCopy();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  async function close() {
    if (!await allowEmployerContextChange()) return;
    dialog.current?.close(); setOpen(false);
  }
  return <>
    <header className={s.header} data-hr-assistant-header>
      <img src="/brand/talentio-logo-4k.png" alt="Talentio" />
      <button type="button" onClick={() => setOpen(true)}><span aria-hidden="true">?</span>{c('Bantuan HR')}</button>
    </header>
    {open && <dialog ref={dialog} className={s.supportDialog} aria-label={c('Bantuan HR')} onCancel={event => { event.preventDefault(); void close(); }} onClick={event => { if (event.target === event.currentTarget) void close(); }}>
      <button type="button" className={s.closeSupport} aria-label={c('Tutup bantuan')} onClick={() => void close()}>×</button>
      <ConfirmProvider><HrSupport companyId={companyId} companyName={companyName} /></ConfirmProvider>
    </dialog>}
  </>;
}

type Props = { companyId: string; companyName: string; userId: string; creationSessionId: string; initialScene: AssistantSceneId; onContinue: (files: File[]) => Promise<void> };
export function HrAssistantOnboarding({ companyId, companyName, userId, creationSessionId, initialScene, onContinue }: Props) {
  const c = useHrCopy();
  useHrAssistantSurface(companyId, companyName);
  const [scene, setScene] = useState<AssistantSceneId>(initialScene);
  const [leaving, setLeaving] = useState(false), [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]), [uploadError, setUploadError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  function chooseFiles(files: File[]) {
    const invalid = files.find(file => !/\.(pdf|docx?)$/i.test(file.name) || !file.size || file.size > 5 * 1024 * 1024);
    if (invalid) { setUploadError(invalid.name + ': gunakan PDF, DOC atau DOCX maksimal 5 MB.'); return; }
    setUploadError(''); setSelectedFiles(previous => [...previous, ...files.filter(file => !previous.some(value => value.name === file.name && value.size === file.size && value.lastModified === file.lastModified))]);
  }
  async function finish() {
    if (lock.current) return; lock.current = true; setBusy(true); setUploadError('');
    try { await onContinue(selectedFiles); }
    catch (error) { setUploadError(error instanceof Error ? error.message : 'Belum bisa melanjutkan. Coba lagi.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const stage = useRef<HTMLDivElement>(null), heading = useRef<HTMLDivElement>(null);
  const lock = useRef(false), timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const reducedMotion = useRef(false);
  const index = assistantScenes.indexOf(scene);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = () => setScale(Math.min(element.clientWidth / 1672, element.clientHeight / 747));
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { reducedMotion.current = media.matches; };
    change(); media.addEventListener('change', change);
    preload.forEach(name => { const image = new Image(); image.src = asset(name); });
    return () => { media.removeEventListener('change', change); timers.current.forEach(clearTimeout); };
  }, []);
  useEffect(() => { saveAssistantProgress(userId, creationSessionId, scene); }, [userId, creationSessionId, scene]);
  function navigate(direction: -1 | 1) {
    if (lock.current || index + direction < 0 || index + direction >= assistantScenes.length) return;
    lock.current = true; setBusy(true); setLeaving(true);
    timers.current.push(setTimeout(() => {
      const next = assistantScenes[index + direction];
      saveAssistantProgress(userId, creationSessionId, next);
      setScene(next); setLeaving(false);
      heading.current?.focus({ preventScroll: true });
      stage.current?.scrollTo({ top: 0 });
      timers.current.push(setTimeout(() => { lock.current = false; setBusy(false); }, reducedMotion.current ? 0 : 1050));
    }, reducedMotion.current ? 0 : 300));
  }

  const narrator = (children: ReactNode, className: string) => <Bubble className={`${s.narrator} ${className}`}>{children}</Bubble>;
  return <section className={s.viewport} data-hr-assistant data-scene={scene} aria-label={c('Kenalan dengan Taka')}>
    <div ref={stage} className={s.stage}>
      <div ref={heading} tabIndex={-1} className={`${s.canvas} ${leaving ? s.leaving : ''}`} style={{ '--scene-scale': scale } as CSSProperties} data-scene-content>
        <div key={scene} className={`${s.scene} ${s[scene.replaceAll('-', '_')]}`}>
          {scene === 'taka-intro' && <>
            <Art name="taka-wave" alt="Taka" className={s.introTaka} />
            <Bubble className={s.introBubble}><span className={s.speaker}>Taka</span><h1>{c('Hai, gua Taka!')}</h1><p className={s.introLead}>{c('Gua AI Assistant yang bakal bantu lu ngurus rekrutmen.')}</p><p className={s.introHint}>{c('Yuk, gua tunjukin apa aja yang bisa gua bantu.')}</p></Bubble>
          </>}

          {scene === 'cv-sources' && <>
            <div className={s.sourcesPaths} aria-hidden="true">{[0,1,2].map(i=><div key={i}><Art name="arrow-left" className={s.flowArrow} style={{left:270,top:225+i*170,width:535,height:[290,160,40][i]}}/><Art name="arrow-right" className={s.flowArrow} style={{left:1105,top:225+i*170,width:310,height:[260,130,30][i]}}/></div>)}</div>
            {['jobstreet','glints','kitalulus','dealls','linkedin','kalibrr'].map((name,i) => <div key={name} className={s.portal} style={{ left: i < 3 ? 40 : 1394, top: 168+(i%3)*170, '--enter-delay': `${i*95}ms` } as CSSProperties}><img src={asset('logo-'+name)} alt={['JobStreet by SEEK','glints','kitalulus','Dealls!','LinkedIn','kalibrr'][i]} /></div>)}
            <div className={s.collectionArt}><Art name="taka-collect" alt={c('Taka mengumpulkan CV ke Talentio')} className={s.collectTaka}/><Art name="talentio-tray" alt="Talentio" className={s.collectionTray}/><Art name="cv-stack" className={s.heldCvs}/></div>
            {[0,1,2,3,4,5].map(i => <Art key={i} name="cv-sheet" className={s.cvPaper} style={{ left:i<3?320:1250,top:236+(i%3)*170, '--enter-delay':`${450+i*75}ms`, '--cv-x':`${960-(i<3?320:1250)}px`, '--cv-y':`${500-(236+(i%3)*170)}px` } as CSSProperties}/>)}
            <Bubble className={s.sourcesBubble}><h1>{c('CV kandidat lu masih nyebar di berbagai job portal?')}</h1><p>{c('Upload semuanya ke sini. Biar kandidat lu ngumpul di satu tempat.')}</p></Bubble>
          </>}

          {scene === 'cv-ranking' && <>
            <section className={s.rankingPanel}><header><h1>{c('Kecocokan CV')}</h1><span>{c('Contoh ranking')}</span></header><ol className={s.rankList}>{[{name:'Nadia Putri',score:97},{name:'Rizky Pratama',score:84},{name:'Dimas Saputra',score:61}].map((candidate,i) => <li key={candidate.name} style={{ '--enter-delay':`${180+i*160}ms`, '--rank-offset':`${[163,-163,0][i]}px` } as CSSProperties}><span className={s.rankNumber}>{i+1}</span><Art name={`candidate-${i+1}`} alt=""/><div className={s.rankDetails}><strong>{candidate.name}</strong><span className={s.fitLabel}><span aria-hidden="true">✓</span> {c('Cocok')} ({candidate.score}%)</span><div className={s.fitTrack}><span style={{width:`${candidate.score}%`}} /></div></div><b className={s.score}>{candidate.score}/100</b></li>)}</ol></section>
            <Art name="taka-ranking" alt="Taka" className={s.rankingTaka}/>
            {narrator(<><strong>{c('Gua cek kecocokan tiap CV sama posisi yang lu cari.')}</strong><p>{c('Terus gua urutin kandidatnya. Lu tinggal pilih siapa yang mau dilanjutin.')}</p></>,s.rankingNarrator)}
          </>}

          {scene === 'tara-intro' && <>
            <Art name="taka-proud" alt="Taka" className={s.proudTaka}/><Art name="tara-wave" alt="Tara" className={s.welcomeTara}/>
            <Bubble className={s.taraBubble}><span className={s.speaker}>Taka</span><h1>{c('Kenalin, ini adik gua, Tara!')}</h1><p>{c('Dia bisa gali pengalaman kandidat lu, termasuk kemampuan teknisnya.')}</p></Bubble>
            <div className={`${s.roleLabel} ${s.takaRole}`}><strong>Taka</strong><span>{c('Evaluasi hasil interview')}</span></div><div className={`${s.roleLabel} ${s.taraRole}`}><strong>Tara</strong><span>{c('Interview kandidat')}</span></div>
            <p className={s.roleSummary}>{c('Tara yang interview, gua yang nilai hasilnya.')}</p>
          </>}

          {scene === 'chat-demo' && <>
            <section className={s.chatPanel}><header><Art name="tara-chat-header" alt=""/><h1>{c('Chat dengan Tara')}</h1><span>{c('Contoh screening')}</span></header>
              <div className={`${s.message} ${s.questionOne}`}><Art name="tara-chat-thinking" alt="Tara"/><p>{c('Boleh ceritain proyek terakhir yang kamu kerjakan?')}</p></div>
              <div className={`${s.message} ${s.answer}`}><p>{c('Saya membangun API dan integrasi pembayaran.')}</p><Art name="candidate-chat" alt={c('Kandidat')}/></div>
              <div className={`${s.message} ${s.questionTwo}`}><Art name="tara-chat-notes" alt="Tara"/><p>{c('Kalau pembayarannya gagal, gimana kamu menanganinya?')}</p></div>
              <span className={s.typing} aria-hidden="true"><i/><i/><i/></span>
            </section>
            <Art name="taka-chat" alt="Taka" className={s.chatTaka}/>
            {narrator(<strong>{c('Kandidat bisa ngobrol sama Tara lewat chat. Dari jawabannya, Tara bakal gali lebih jauh.')}</strong>,s.chatNarrator)}
          </>}

          {scene === 'voice-demo' && <>
            <section className={s.voicePanel}><header><span className={s.micBadge}><Microphone/></span><div><h1>{c('Live interview dengan Tara')}</h1><p>{c('Contoh interview suara')}</p></div></header>
              <div className={s.speakingRings} aria-hidden="true"/><Art name="tara-interviewer" alt={c('Tara, interviewer')} className={s.interviewer}/>
              <strong className={s.voiceName}>Tara</strong><span className={s.speakingStatus}><i/>{c('Sedang berbicara')}</span>
              <div className={s.waveform} aria-hidden="true">{Array.from({length:57},(_,i) => <i key={i} style={{height:6+(Math.sin(i*2.4)**2)*38*(1-Math.abs(i-28)/34),animationDelay:`${i*37}ms`}}/>)}</div>
              <div className={s.callControls}><button type="button" aria-disabled="true" aria-label={c('Mikrofon contoh interview')}><Microphone/></button><button type="button" aria-disabled="true" aria-label={c('Akhiri contoh interview')}><svg aria-hidden="true" viewBox="0 0 40 25"><path d="M3 18V9C9 0 31 0 37 9v9l-9-1v-7H12v7Z"/></svg></button></div>
            </section>
            <Art name="taka-interview" alt="Taka" className={s.voiceTaka}/>
            {narrator(<><span className={s.narratorName}>Taka</span><div><strong>{c('Kandidat juga bisa ngobrol langsung lewat suara.')}</strong><p>{c('Abis interview, gua evaluasi hasilnya.')}</p></div></>,s.voiceNarrator)}
          </>}

          {scene === 'cv-upload' && <>
            <section className={s.uploadPanel}><h1>{c('Upload CV kandidat')}</h1><div className={s.dropzone} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();event.stopPropagation();chooseFiles(Array.from(event.dataTransfer.files));}} aria-label={c('Area upload CV')}><Art name="upload-cloud" className={s.uploadCloud}/><strong>{c('Tarik CV ke sini')}</strong><span>{c('atau')}</span><input ref={fileInput} hidden type="file" multiple accept=".pdf,.doc,.docx" onChange={event=>{chooseFiles(Array.from(event.target.files??[]));event.target.value='';}}/><button type="button" disabled={busy} onClick={()=>fileInput.current?.click()}>{c('Pilih file')}</button></div><p className={s.uploadHint}>{selectedFiles.length ? selectedFiles.length + ' CV dipilih · PDF, DOC, DOCX' : c('Bisa pilih banyak CV sekaligus')}</p>{uploadError && <p role="alert" className={s.uploadHint}>{uploadError}</p>}</section>
            <Art name="taka-upload" alt="Taka" className={s.uploadTaka}/>
            {narrator(<><strong>{c('Yuk, masukin CV kandidat yang udah lu punya.')}</strong><p>{c('Boleh banyak sekaligus. Abis di-upload, gua mulai proses dan bikin rankingnya.')}</p></>,s.uploadNarrator)}
          </>}
        </div>
      </div>
    </div>
    <footer className={s.footer}>
      {index > 0 && <button type="button" className={s.back} disabled={busy} onClick={()=>navigate(-1)}><Arrow back/>{c('Kembali')}</button>}
      {index === assistantScenes.length-1 && <button type="button" className={s.next} disabled={busy} onClick={()=>void finish()}>{busy ? c('Menyiapkan dashboard…') : c('Lanjut')}<Arrow/></button>}
      {index < assistantScenes.length-1 && <button type="button" className={s.next} disabled={busy} onClick={()=>navigate(1)}>{c('Lanjut')}<Arrow/></button>}
    </footer>
  </section>;
}
