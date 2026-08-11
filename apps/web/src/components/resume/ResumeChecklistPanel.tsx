'use client';

import { useI18n } from '@/lib/i18n';

type ChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  tip?: string;
};

type Props = {
  checklist: {
    score: number;
    items: ChecklistItem[];
  };
};

export function ResumeChecklistPanel({ checklist }: Props) {
  const { t } = useI18n();

  return (
    <aside className="resume-checklist card">
      <div className="resume-checklist__head">
        <h3 style={{ margin: 0 }}>{t('ui.atsChecklist')}</h3>
        <div className="resume-checklist__score">{checklist.score}%</div>
      </div>
      <div className="completeness-bar" style={{ margin: '0.75rem 0 1rem' }}>
        <span style={{ width: `${checklist.score}%` }} />
      </div>
      <ul className="resume-checklist__list">
        {checklist.items.map((item) => (
          <li key={item.id} className={item.ok ? 'ok' : 'todo'}>
            <span className="resume-checklist__mark" aria-hidden>
              {item.ok ? '✓' : '○'}
            </span>
            <div>
              <strong>{item.label}</strong>
              {!item.ok && item.tip ? (
                <p className="muted" style={{ margin: '0.15rem 0 0', fontSize: '0.82rem' }}>
                  {item.tip}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
