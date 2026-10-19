'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n';
import { ProfileIcon } from './ProfileIcon';
import s from './ProfileWorkspace.module.css';

export function ProfileDialog({ title, subtitle, children, onClose, busy = false, wide = false, guardChanges = false, hideHeader = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; guardChanges?: boolean; hideHeader?: boolean }) {
  const { t } = useI18n();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const latest = useRef({ busy, dirty, onClose, guardChanges, discard });
  latest.current = { busy, dirty, onClose, guardChanges, discard };
  function keepEditing() {
    setDiscard(false);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }
  function discardChanges() {
    if (latest.current.busy) return;
    setDiscard(false);
    latest.current.onClose();
  }
  function onDiscardKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      keepEditing();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = Array.from(discardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') || []);
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !discardRef.current?.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !discardRef.current?.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }
  function close() {
    if (latest.current.busy) return;
    if (latest.current.guardChanges && latest.current.dirty) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDiscard(true);
      return;
    }
    latest.current.onClose();
  }
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const active = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea') || ref.current?.querySelector<HTMLElement>('button'))?.focus());
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (latest.current.discard) return;
      if (document.querySelector('.confirm-modal-backdrop')) return;
      if (event.key === 'Escape' && ref.current?.querySelector('[role="combobox"][aria-expanded="true"], [aria-haspopup="listbox"][aria-expanded="true"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter((node) => node.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = previous; document.removeEventListener('keydown', onKey); active?.focus(); };
  }, [mounted]);
  useEffect(() => {
    if (!discard) return;
    const frame = requestAnimationFrame(() => discardRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [discard]);
  if (!mounted) return null;
  return createPortal(<div className={s.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={ref} className={`${s.dialog} ${wide ? s.wideDialog : ''}`} role="dialog" aria-modal="true" aria-hidden={discard || undefined} aria-labelledby={id} aria-busy={busy} onChangeCapture={() => { if (guardChanges) setDirty(true); }}>
      {hideHeader ? <h2 id={id} className="sr-only">{title}</h2> : <header className={s.dialogHeader}><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className={s.iconButton} aria-label={t('closeDialog')} onClick={close} disabled={busy}><ProfileIcon kind="close" /></button></header>}
      {children}
    </div>
    {discard && <div className={s.discardBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) keepEditing(); }} onKeyDown={onDiscardKeyDown}>
      <div ref={discardRef} className={s.discardDialog} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-unsaved`}>
        <h2 id={`${id}-unsaved`}>{t('pc.unsaved')}</h2>
        <div className={s.discardActions}>
          <button type="button" className={s.secondary} onClick={keepEditing}>{t('pc.keepEditing')}</button>
          <button type="button" className={s.dangerButton} onClick={discardChanges}>{t('pc.discard')}</button>
        </div>
      </div>
    </div>}
  </div>, document.body);
}
