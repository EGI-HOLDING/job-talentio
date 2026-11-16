import type { ReactNode } from 'react';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { useI18n } from '@/lib/i18n';
import s from './CandidateReview.module.css';

export function useReviewCopy() {
  const { locale } = useI18n();
  return (id: string, en: string) => locale === 'id' ? id : en;
}

export const candidateInitials = (name: string) => name.trim().split(/\s+/).slice(0, 2)
  .map(word => Array.from(word)[0] ?? '').join('').toUpperCase();

export function ReviewPill({ children, tone = 'good', icon }: { children: ReactNode; tone?: 'good' | 'warning' | 'violet'; icon?: string }) {
  return <span className={s.pill} data-tone={tone}>{icon && <WorkspaceIcon kind={icon} />}{children}</span>;
}

export function ReviewCharacter({ character, working = false, compact = false }: {
  character: 'taka' | 'tara'; working?: boolean; compact?: boolean;
}) {
  const image = character === 'tara' ? 'tara-interviewer' : 'taka-ranking';
  return <div aria-hidden="true" className={s.character} data-character={character} data-working={working} data-compact={compact}>
    <img src={'/images/hr-onboarding/generated/' + image + '.webp'} alt="" draggable={false} />
    {!compact && <span className={s.characterAccent}><i /><i /><i /></span>}
    {character === 'tara' && !compact && <>
      <span className={s.taraNotes}><WorkspaceIcon kind="check" /><i /><i /><i /></span>
      <span className={s.taraWave}>{[1, 2, 3, 4, 5, 6, 7].map(bar => <i key={bar} />)}</span>
    </>}
  </div>;
}

export function ReviewError({ children, retry }: { children: ReactNode; retry?: () => void }) {
  const c = useReviewCopy();
  return <div className={s.alert} role="alert"><span>{children}</span>
    {retry && <button type="button" className={s.textAction} onClick={retry}>{c('Coba lagi', 'Try again')}</button>}
  </div>;
}

export function reviewDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));
}

export function reviewTime(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date));
}

export function localDateKey(value: string) {
  const date = new Date(value);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
}
