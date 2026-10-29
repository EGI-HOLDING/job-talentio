'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n';
import { JobRowIcon } from './JobRowIcon';
import s from './RecruiterJobTable.module.css';

type Props = { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; busy?: boolean; onClose: () => void; returnFocus: RefObject<HTMLButtonElement | null> };
export function JobRowDialog({ title, subtitle, children, footer, busy = false, onClose, returnFocus }: Props) {
  const { t } = useI18n();
  const id = useId(), panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]') || []).filter(item => item.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); panel.current?.focus(); }
        else if (!panel.current?.contains(document.activeElement) || document.activeElement === panel.current || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); else returnFocus.current?.focus(); };
  }, []);
  return createPortal(<div className={s.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div ref={panel} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={subtitle ? id + '-subtitle' : undefined} tabIndex={-1}>
    <header className={s.dialogHeader}><div><h2 id={id}>{title}</h2>{subtitle && <p id={id + '-subtitle'}>{subtitle}</p>}</div><button type="button" className={s.iconButton} aria-label={t('close')} disabled={busy} onClick={onClose}><JobRowIcon kind="close" /></button></header>
    <div className={s.dialogBody}>{children}</div>{footer && <footer className={s.dialogFooter}>{footer}</footer>}
  </div></div>, document.body);
}
