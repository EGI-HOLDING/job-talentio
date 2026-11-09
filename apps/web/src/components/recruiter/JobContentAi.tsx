'use client';

import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import s from './JobContentAi.module.css';

export type JobContentAiTarget = 'description' | 'responsibilities' | 'kpis' | 'skills';
export type JobContentAiSkill = { name: string; isRequired: boolean; minLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT' | null };
export type JobContentAiSuggestion =
  | { description: string }
  | { items: string[] }
  | { items: JobContentAiSkill[] };

export function JobContentAiButton({ label, disabled, loading, onClick }: {
  label: string; disabled?: boolean; loading?: boolean; onClick: () => void;
}) {
  const c = useHrCopy();
  return <button className={s.action} type="button" disabled={disabled || loading} onClick={onClick} aria-label={c('Buat dengan AI') + ': ' + label} aria-busy={loading || undefined} title={c('Buat dengan AI') + ': ' + label}>
    <svg className={loading ? s.loading : undefined} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 14.2 9.8 21.2 12l-7 2.2-2.2 7-2.2-7L2.8 12l7-2.2L12 2.8Z" fill="currentColor"/>
      <path d="m19 2 .9 2.1L22 5l-2.1.9L19 8l-.9-2.1L16 5l2.1-.9L19 2Z" fill="currentColor" opacity=".55"/>
    </svg>
    <span>AI</span>
  </button>;
}

export function JobContentAiHelp() {
  const c = useHrCopy();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  return <span className={s.help} ref={root}>
    <button className={s.helpButton} type="button" aria-label={c('Tentang bantuan AI')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>?</button>
    {open && <span className={s.helpPopup} id={id} role="status">
      <strong>{c('Tentang bantuan AI')}</strong>
      <span>{c('AI membantu membuat draf untuk deskripsi posisi, tanggung jawab, KPI, atau keahlian dari konteks perusahaan dan posisi. Periksa hasilnya sebelum diterapkan; perubahan belum disimpan sampai lowongan disimpan.')}</span>
      <button type="button" onClick={() => setOpen(false)}>{c('Tutup')}</button>
    </span>}
  </span>;
}

export function JobContentAiPreview({ title, children, onCancel, onApply }: {
  title: string; children: ReactNode; onCancel: () => void; onApply: () => void;
}) {
  const c = useHrCopy();
  const id = useId();
  const modal = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const apply = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancelRef.current(); }
      if (event.key === 'Tab' && modal.current) {
        const focusable = Array.from(modal.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter(element => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section ref={modal} className={'modal ' + s.preview} role="dialog" aria-modal="true" aria-labelledby={id}>
      <header><div><span className={s.eyebrow}>{c('Saran AI')}</span><h2 id={id}>{title}</h2></div><button className={s.close} type="button" onClick={onCancel} aria-label={c('Tutup')}>×</button></header>
      <p className={s.replaceHint}>{c('Hasil AI untuk bagian ini akan mengganti isi yang sekarang setelah diterapkan.')}</p>
      <div className={s.previewBody}>{children}</div>
      <footer><button className={s.cancel} type="button" ref={cancel} onClick={onCancel}>{c('Batal')}</button><button className={s.apply} type="button" ref={apply} onClick={onApply}>{c('Terapkan')}</button></footer>
    </section>
  </div>, document.body);
}
