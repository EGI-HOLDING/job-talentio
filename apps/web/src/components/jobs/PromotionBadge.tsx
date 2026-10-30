'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JobPromotion } from '@job-talentio/shared';
import { useI18n } from '@/lib/i18n';
import s from './PromotionBadge.module.css';

export function PromotionBadge({ promotion }: { promotion?: JobPromotion | null }) {
  const { t } = useI18n();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const active = promotion?.active && (!promotion.revalidateAt || Date.parse(promotion.revalidateAt) > Date.now());

  useLayoutEffect(() => {
    if (!open || !active) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(288, window.innerWidth - 32);
      const height = panel.current?.offsetHeight ?? 100;
      setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
        top: Math.max(12, rect.bottom + height + 8 <= window.innerHeight - 12 ? rect.bottom + 8 : rect.top - height - 8) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', keyboard); };
  }, [open]);

  if (!active) return null;
  return <>
    <button ref={trigger} type="button" className={s.badge} aria-expanded={open} aria-controls={open ? id : undefined}
      aria-describedby={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      {t('job.promoted')}<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" /><path d="M8 7v4M8 4.5v1" stroke="currentColor" strokeLinecap="round" /></svg>
    </button>
    {open && createPortal(<div ref={panel} id={id} role="tooltip" className={s.popover} style={position}>{t('job.promotionInfo')}</div>, document.body)}
  </>;
}
