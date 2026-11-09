'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';
import { HrSupport } from './HrSupport';
import { allowEmployerContextChange } from './useEmployerUnsaved';
import { CandidateCvFiles } from './CandidateCvFiles';
import { useHrAssistantSurface } from './HrFlowPresentation';
import { assistantScenes, saveAssistantProgress, type AssistantSceneId } from './hrAssistantState';
import s from './HrAssistantOnboarding.module.css';

const asset = (name: string) => `/images/hr-onboarding/generated/${name}.${name.startsWith('tara-chat-') || name.startsWith('candidate-') ? 'browser.png' : 'webp'}`;
const preload = ['taka-wave', 'taka-collect', 'taka-ranking', 'taka-proud', 'tara-wave', 'taka-chat', 'taka-interview', 'taka-upload', 'tara-chat-header', 'tara-chat-thinking', 'tara-chat-notes', 'tara-interviewer', 'candidate-chat', 'candidate-1', 'candidate-2', 'candidate-3', 'cv-sheet', 'cv-stack', 'talentio-tray', 'upload-cloud'];

function Arrow({ back = false }: { back?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 28 24"><path d={back ? 'M25 12H3m9-9-9 9 9 9' : 'M3 12h22m-9-9 9 9-9 9'} /></svg>;
}
function Microphone() {
  return <svg aria-hidden="true" viewBox="0 0 30 36"><rect x="9" y="2" width="12" height="21" rx="6" /><path d="M3 16v3a12 12 0 0 0 24 0v-3M15 31v4M9 35h12" /></svg>;
}
const portalRoutes = [
  'M294 221 C406 164 485 297 548 359 S676 416 751 483',
  'M294 392 C420 337 486 413 554 459 S687 498 751 522',
  'M294 559 C425 631 564 614 641 583 S709 564 751 566',
  'M1394 223 C1308 160 1232 285 1182 378 S1154 437 1131 484',
  'M1394 394 C1296 342 1256 428 1201 469 S1155 508 1131 523',
  'M1394 558 C1316 618 1240 624 1179 595 S1153 572 1131 566',
];
const ribbons = '/images/hr-onboarding/generated/cv-ribbon-flow.png';
const voiceControls = '/images/hr-onboarding/generated/voice-preview-controls.png';

function RibbonCrop({ viewBox, x, y, width, height }: { viewBox: string; x: number; y: number; width: number; height: number }) {
  return <svg viewBox={viewBox} x={x} y={y} width={width} height={height} preserveAspectRatio="none" overflow="hidden">
    <image data-cv-ribbon href={ribbons} width="2172" height="724"/>
  </svg>;
}

function CvPortalFlow() {
  return <>
    <svg className={s.sourcesPaths} viewBox="0 0 1672 747" aria-hidden="true">
      <RibbonCrop viewBox="22 90 913 590" x={270} y={172} width={488} height={457}/>
      <RibbonCrop viewBox="1447 90 702 590" x={1118} y={172} width={309} height={457}/>
      {portalRoutes.map((route, index) => <MovingCv key={route} route={route} angle={index < 3 ? 16 : -16} delay={0.6 + (index % 3) * 0.42 + (index >= 3 ? 0.24 : 0)}/>)}
    </svg>
    <svg className={s.trayFlow} viewBox="0 0 1672 747" aria-hidden="true">
      <RibbonCrop viewBox="1080 423 229 114" x={872} y={432} width={108} height={64}/>
      <MovingCv route="M883 445Q924 444 951 482L957 510" angle={-12} delay={1.65} width={49}/>
    </svg>
  </>;
}

function MovingCv({ route, angle, delay, width = 60 }: { route: string; angle: number; delay: number; width?: number }) {
  const height = width * 1.3;
  const begin = delay.toFixed(2) + 's';
  return <g className={s.flowDocument}>
    <image href={asset('cv-sheet')} x={-width / 2} y={-height / 2} width={width} height={height} transform={'rotate(' + angle + ')'}/>
    <animateMotion path={route} dur="3.2s" begin={begin} repeatCount="indefinite" keyPoints="0;0.12;1;1" keyTimes="0;0.13;0.88;1" calcMode="linear"/>
    <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.12;0.78;0.88;1" dur="3.2s" begin={begin} repeatCount="indefinite"/>
  </g>;
}

function MobileCvFlow() {
  const route = 'M60 10V66';
  return <svg className={s.mobileCvFlow} viewBox="0 0 120 78" aria-hidden="true">
    <g transform="rotate(35 60 39)"><RibbonCrop viewBox="1080 423 229 114" x={30} y={19} width={64} height={39}/></g>
    <MovingCv route={route} angle={12} delay={0.5} width={25}/>
  </svg>;
}

function PreviewCallIcon({ kind }: { kind: 'mic' | 'end' }) {
  const crop = kind === 'mic' ? '376 166 487 487' : '1047 166 487 487';
  return <svg aria-hidden="true" viewBox={crop} className={s.previewCallIcon}>
    <image href={voiceControls} width="1920" height="819"/>
  </svg>;
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

export type AssistantFinishAction = 'upload' | 'skip';

type Props = {
  companyId: string;
  companyName: string;
  userId: string;
  creationSessionId: string;
  initialScene: AssistantSceneId;
  selectedFiles: File[];
  setSelectedFiles: Dispatch<SetStateAction<File[]>>;
  pendingAction?: AssistantFinishAction;
  onBackToJob: () => void;
  onFinish: (action: AssistantFinishAction) => Promise<void>;
};
export function HrAssistantOnboarding({
  companyId, companyName, userId, creationSessionId, initialScene,
  selectedFiles, setSelectedFiles, pendingAction, onBackToJob, onFinish,
}: Props) {
  const c = useHrCopy();
  useHrAssistantSurface(companyId, companyName);
  const [scene, setScene] = useState<AssistantSceneId>(initialScene);
  const [leaving, setLeaving] = useState(false), [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(1);
  const [uploadError, setUploadError] = useState('');
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const stage = useRef<HTMLDivElement>(null), heading = useRef<HTMLDivElement>(null);
  const lock = useRef(false), timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const reducedMotion = useRef(false);
  const index = assistantScenes.indexOf(scene);
  const isFinalScene = scene === 'cv-upload';

  async function finish(action: AssistantFinishAction) {
    if (lock.current || (pendingAction && pendingAction !== action)) return;
    if (action === 'upload' && selectedFiles.length === 0) return;
    lock.current = true;
    setBusy(true);
    setUploadError('');
    try {
      await onFinish(action);
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message + ' ' : '';
      setUploadError(reason + c(action === 'upload' ? 'Klik Upload untuk mencoba lagi.' : 'Klik Lewati untuk mencoba lagi.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function skip() {
    if (lock.current || showSkipConfirm || pendingAction === 'upload') return;
    if (selectedFiles.length > 0 && !pendingAction) setShowSkipConfirm(true);
    else void finish('skip');
  }

  function back() {
    if (lock.current || pendingAction) return;
    if (index === 0) onBackToJob();
    else navigate(-1);
  }

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
    [...preload.map(asset), ribbons, voiceControls].forEach(src => { const image = new Image(); image.src = src; });
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
            <CvPortalFlow/>
            {['jobstreet','glints','kitalulus','dealls','linkedin','kalibrr'].map((name,i) => <div key={name} className={s.portal} style={{ left: i < 3 ? 40 : 1394, top: 168+(i%3)*170, '--enter-delay': `${i*95}ms` } as CSSProperties}><img src={asset('logo-'+name)} alt={['JobStreet by SEEK','glints','kitalulus','Dealls!','LinkedIn','kalibrr'][i]} /></div>)}
            <MobileCvFlow/>
            <div className={s.collectionArt}><Art name="taka-collect" alt={c('Taka mengumpulkan CV ke Talentio')} className={s.collectTaka}/><Art name="talentio-tray" alt="Talentio" className={s.collectionTray}/><Art name="cv-stack" className={s.heldCvs}/></div>
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
            <section className={s.voicePanel}><header><span className={s.micBadge}><Microphone/></span><div><h1>{c('Interview suara dengan Tara')}</h1></div></header>
              <div className={s.speakingRings} aria-hidden="true"/><Art name="tara-interviewer" alt={c('Tara, interviewer')} className={s.interviewer}/>
              <strong className={s.voiceName}>Tara</strong><span className={s.speakingStatus}><i/>{c('Sedang berbicara')}</span>
              <div className={s.waveform} aria-hidden="true">{Array.from({length:57},(_,i) => <i key={i} style={{height:6+(Math.sin(i*2.4)**2)*38*(1-Math.abs(i-28)/34),animationDelay:`${i*37}ms`}}/>)}</div>
              <div className={s.callControls}><button type="button" aria-disabled="true" aria-label={c('Mikrofon contoh interview')}><PreviewCallIcon kind="mic"/></button><button type="button" aria-disabled="true" aria-label={c('Akhiri contoh interview')}><PreviewCallIcon kind="end"/></button></div>
            </section>
            <Art name="taka-interview" alt="Taka" className={s.voiceTaka}/>
            {narrator(<><span className={s.narratorName}>Taka</span><div><strong>{c('Kandidat juga bisa ngobrol langsung lewat suara.')}</strong><p>{c('Abis interview, gua evaluasi hasilnya.')}</p></div></>,s.voiceNarrator)}
          </>}

          {scene === 'cv-upload' && <>
            <section className={s.uploadPanel} data-has-files={selectedFiles.length > 0}>
              <h1>{c('Upload CV kandidat')}</h1>
              <CandidateCvFiles files={selectedFiles} setFiles={setSelectedFiles} disabled={busy || Boolean(pendingAction)} illustrated/>
              {busy && <p role="status" className={s.uploadHint}>{c('Menyiapkan dashboard\u2026')}</p>}
              {uploadError && <p role="alert" className={s.uploadHint}>{uploadError}</p>}
            </section>
          </>}
        </div>
      </div>
      {scene === 'cv-upload' && <div className={s.uploadGuide}>
        {narrator(<><strong>{c('Yuk, masukin CV kandidat yang udah lu punya.')}</strong><p>{c('Pilih atau tarik CV untuk menambahkannya ke daftar. Klik Upload untuk mengirimnya.')}</p></>,s.uploadNarrator)}
        <Art name="taka-upload" alt="Taka" className={s.uploadTaka}/>
      </div>}
    </div>
    <footer className={s.footer} data-final={isFinalScene || undefined}>
      <button type="button" className={s.back} disabled={busy || Boolean(pendingAction)} onClick={back}><Arrow back/>{c('Kembali')}</button>
      {isFinalScene ? <>
        <button type="button" className={s.skip} disabled={busy || pendingAction === 'upload'} onClick={skip}>{c('Lewati')}</button>
        <button type="button" className={s.next} disabled={busy || pendingAction === 'skip' || selectedFiles.length === 0} onClick={() => void finish('upload')}>{c('Upload')}<Arrow/></button>
      </> : <button type="button" className={s.next} disabled={busy} onClick={() => navigate(1)}>{c('Lanjut')}<Arrow/></button>}
    </footer>
    {showSkipConfirm && <ConfirmModal
      tone="danger"
      title={c('Lewati upload CV?')}
      message={c('CV yang dipilih belum diunggah. Jika lanjut, file ini tidak akan tersimpan.')}
      cancelLabel={c('Batal')}
      confirmLabel={c('Lanjut')}
      onCancel={() => setShowSkipConfirm(false)}
      onConfirm={() => { setShowSkipConfirm(false); void finish('skip'); }}
    />}
  </section>;
}
