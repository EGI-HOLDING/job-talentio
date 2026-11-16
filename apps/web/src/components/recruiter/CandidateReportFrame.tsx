'use client';

import { useRef, type ReactNode } from 'react';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { candidateInitials, ReviewCharacter } from './candidate-review-view';
import s from './CandidateReview.module.css';

export type ReportTab = 'summary' | 'criteria' | 'evidence';
type ReportEvidence = { quote: string; label: string; anchor?: string; onOpen?: () => void };

export function CandidateReportFrame({ title, name, subtitle, metadata, download, score, scoreLabel, coverage,
  context, tabs, tab, onTab, children }: {
  title: string; name: string; subtitle: string; metadata: ReactNode; download: ReactNode;
  score: string | null; scoreLabel: ReactNode; coverage?: ReactNode; context: 'cv' | 'interview';
  tabs: Record<ReportTab, string>; tab: ReportTab; onTab: (tab: ReportTab) => void; children: ReactNode;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panels = ['summary', 'criteria', 'evidence'] as const;
  return <>
    <header className={s.reportHeader} data-context={context}>
      <h1>{title}</h1>
      <div className={s.reportIdentity}>
        <span className={s.candidateAvatar} aria-hidden="true">{candidateInitials(name)}</span>
        <div><h2>{name}</h2><p>{subtitle}</p></div>
      </div>
      <div className={s.reportMetadata}>{metadata}</div>
      <div className={s.reportDownload}>{download}</div>
    </header>
    <section className={s.reportHero} data-context={context}>
      <ReviewCharacter character="taka" />
      <div className={s.reportScore}>
        {context === 'interview' && <strong className={s.reportScoreLabel}>{scoreLabel}</strong>}
        {score !== null && <span className={s.score} data-has-score>{score}</span>}
      </div>
      <div className={s.reportCoverage}>
        {context === 'cv' && <strong>{scoreLabel}</strong>}
        {coverage}
      </div>
    </section>
    <nav className={s.tabs + ' ' + s.reportTabs} role="tablist" aria-label={title}>
      {panels.map((value, index) => <button type="button" role="tab" id={'candidate-report-tab-' + value}
        aria-selected={tab === value} aria-controls="candidate-report-panel" key={value}
        tabIndex={tab === value ? 0 : -1} ref={node => { tabRefs.current[index] = node; }}
        onClick={() => onTab(value)} onKeyDown={event => {
          let nextIndex: number;
          if (event.key === 'ArrowLeft') nextIndex = (index + 2) % 3;
          else if (event.key === 'ArrowRight') nextIndex = (index + 1) % 3;
          else if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = 2;
          else return;
          event.preventDefault();
          onTab(panels[nextIndex]);
          tabRefs.current[nextIndex]?.focus();
        }}>{tabs[value]}</button>)}
    </nav>
    <section className={s.reportBody} role="tabpanel" id="candidate-report-panel"
      aria-labelledby={'candidate-report-tab-' + tab}>{children}</section>
  </>;
}

export function CandidateReportCriterion({ name, score, reason, reasonLabel, evidence,
  initialOpen, children }: {
  name: string; score: string; reason: string; reasonLabel: string; evidence: ReportEvidence[];
  initialOpen: boolean; children?: ReactNode;
}) {
  return <details name="candidate-criteria" className={s.criterion} open={initialOpen}>
    <summary>
      <span className={s.criterionMark}><WorkspaceIcon kind={score.endsWith('/4') ? 'check' : 'info'} /></span>
      <strong>{name}</strong><span className={s.criterionScore}>{score}</span>
      <span className={s.criterionChevron}><DirectionalIcon direction="down" size={21} /></span>
    </summary>
    <div className={s.criterionBody}>
      <div className={s.criterionReason}><span>{reasonLabel}</span><p>{reason}</p></div>
      {children}
      {evidence.map(({ quote, label, onOpen, anchor }, index) => <div className={s.evidence} key={index}>
        <span className={s.quoteMark} aria-hidden="true">“</span>
        <div><strong>{label}</strong><blockquote>{quote}</blockquote></div>
        {onOpen && <button type="button" className={s.textAction} onClick={onOpen}>{anchor}</button>}
      </div>)}
    </div>
  </details>;
}
