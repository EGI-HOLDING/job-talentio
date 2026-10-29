'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@/lib/navigation';
import { employerWorkspaceHref, jobDetailHref } from '@/lib/accountNavigation';
import { packageHref } from '@/lib/jobCommerce';
import { useI18n } from '@/lib/i18n';
import { JobRowIcon } from './JobRowIcon';
import type { JobRowPolicy } from './jobRowPolicy';
import s from './RecruiterJobTable.module.css';

type Props = {
  job: any; companyId: string; busy: boolean; policy: JobRowPolicy;
  benefitPhase: 'loading' | 'ready' | 'error' | 'unavailable';
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onDuplicate: () => void; onEdit: () => void; onReviewPublish: () => void;
  onStatus: (next: string) => void; onBoost: () => void; onCopy: () => void; onRetry: () => void;
};

export function RecruiterJobActions({ job, companyId, busy, policy, benefitPhase, triggerRef, onEdit, onReviewPublish, onStatus, onDuplicate, onBoost, onCopy, onRetry }: Props) {
  const { t } = useI18n();
  const id = useId(), ownTrigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const trigger = triggerRef || ownTrigger;
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const isOpen = Boolean(position);
  function close(restore = true) { setPosition(null); if (restore) trigger.current?.focus(); }
  function act(action: () => void) { close(); action(); }
  function toggle() {
    if (isOpen) { close(); return; }
    const rect = trigger.current!.getBoundingClientRect();
    setPosition({ top: rect.bottom + 8, left: Math.max(12, Math.min(rect.right - 248, window.innerWidth - 260)), maxHeight: window.innerHeight - 24 });
  }
  useLayoutEffect(() => {
    if (!isOpen || !menu.current || !trigger.current) return;
    const anchor = trigger.current.getBoundingClientRect(), height = menu.current.getBoundingClientRect().height;
    const below = window.innerHeight - anchor.bottom - 12, above = anchor.top - 12;
    const flip = height > below && above > below;
    const maxHeight = Math.max(100, Math.min(window.innerHeight - 24, flip ? above - 8 : below - 8));
    const top = flip ? Math.max(12, anchor.top - Math.min(height, maxHeight) - 8) : Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - Math.min(height, maxHeight) - 12));
    setPosition({ top, left: Math.max(12, Math.min(anchor.right - 248, window.innerWidth - 260)), maxHeight });
    menu.current.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus();
  }, [isOpen, benefitPhase, policy.packageAction, policy.boostDetails, policy.canBoost]);
  useEffect(() => {
    if (!isOpen) return;
    function outside(event: Event) {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false);
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled):not([aria-disabled=true])') || []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (event.key === 'Tab') close(false);
    }
    const resize = () => close(false);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key); document.addEventListener('scroll', outside, true); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); document.removeEventListener('scroll', outside, true); window.removeEventListener('resize', resize); };
  }, [isOpen]);
  useEffect(() => { if (busy) setPosition(null); }, [busy]);
  const packageLabel = policy.packageAction === 'view' ? t('jr.viewPackage') : policy.packageAction ? t('commerce.' + policy.packageAction) : '';
  return <>
    <button ref={trigger} type="button" className={s.iconButton} aria-label={`${t('rw.actions')}: ${job.title}`} aria-haspopup="menu" aria-expanded={isOpen} aria-controls={isOpen ? id : undefined} onClick={toggle} onKeyDown={event => { if (event.key === 'ArrowDown' && !isOpen) { event.preventDefault(); toggle(); } }} disabled={busy}><JobRowIcon kind="more" /></button>
    {position && createPortal(<div ref={menu} id={id} className={s.menu} role="menu" aria-label={job.title} style={position}>
      <div role="group" aria-label={t('jr.jobGroup')} className={s.menuGroup}><span className={s.menuHeading}>{t('jr.jobGroup')}</span>
        <button type="button" role="menuitem" onClick={() => act(onEdit)}><JobRowIcon kind="edit" />{t('rec.edit')}</button>
        <Link role="menuitem" href={jobDetailHref(job.id, employerWorkspaceHref('jobs', companyId))} onClick={() => close(false)}><JobRowIcon kind="external" />{t(policy.publicVisible ? 'rec.publicPage' : 'jr.preview')}</Link>
        {policy.publicVisible && <button type="button" role="menuitem" onClick={() => act(onCopy)}><JobRowIcon kind="copy" />{t('jr.copyLink')}</button>}
      </div>
      <div role="group" aria-label={t('jr.packageGroup')} className={s.menuGroup}><span className={s.menuHeading}>{t('jr.packageGroup')}</span>
        {benefitPhase === 'loading' ? <button type="button" role="menuitem" disabled><JobRowIcon kind="clock" />{t('loading')}</button> : benefitPhase !== 'ready' ? <button type="button" role="menuitem" onClick={() => act(onRetry)}><JobRowIcon kind="info" />{t('jr.retryBenefits')}</button> : <>
          {policy.packageAction && <Link role="menuitem" href={packageHref(job.id, employerWorkspaceHref('jobs', companyId))} onClick={() => close(false)}><JobRowIcon kind="briefcase" />{packageLabel}</Link>}
          {policy.boostDetails && <button type="button" role="menuitem" onClick={() => act(onBoost)}><JobRowIcon kind="boost" />{t(policy.canBoost ? 'hr.activateBoost' : 'jr.boostDetails')}</button>}
          {!policy.packageAction && !policy.boostDetails && <span className={s.menuNote}>{t('jr.notAvailable')}</span>}
        </>}
      </div>
      {(policy.canReview || policy.canResume || policy.canReopen || policy.canDuplicate || policy.canPause || policy.canClose) && <div role="group" aria-label={t('jr.manageGroup')} className={s.menuGroup}><span className={s.menuHeading}>{t('jr.manageGroup')}</span>
        {policy.canReview && <button type="button" role="menuitem" onClick={() => act(onReviewPublish)}><JobRowIcon kind="check" />{t('rw.reviewPublish')}</button>}
        {policy.canResume && <button type="button" role="menuitem" onClick={() => act(() => onStatus('PUBLISHED'))}><JobRowIcon kind="play" />{t('rec.resumeJob')}</button>}
        {policy.canReopen && <button type="button" role="menuitem" onClick={() => act(() => onStatus('PUBLISHED'))}><JobRowIcon kind="play" />{t('rec.reopen')}</button>}
        {policy.canPause && <button type="button" role="menuitem" onClick={() => act(() => onStatus('PAUSED'))}><JobRowIcon kind="pause" />{t('rec.pause')}</button>}
        {policy.canDuplicate && <button type="button" role="menuitem" onClick={() => act(onDuplicate)}><JobRowIcon kind="copy" />{t('hr.duplicateJob')}</button>}
        {policy.canClose && <button type="button" role="menuitem" className={s.dangerItem} onClick={() => act(() => onStatus('CLOSED'))}><JobRowIcon kind="close" />{t('rec.closeJob')}</button>}
      </div>}
    </div>, document.body)}
  </>;
}
