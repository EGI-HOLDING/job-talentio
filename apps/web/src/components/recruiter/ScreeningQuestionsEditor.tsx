'use client';

import { useI18n } from '@/lib/i18n';
import { LabelText } from '@/components/ui/Field';

export type ScreeningQuestionType = 'TEXT' | 'YES_NO' | 'NUMBER';

export type ScreeningQuestionDraft = {
  /** Present for questions already saved on the posting. */
  id?: string;
  question: string;
  type: ScreeningQuestionType;
  isRequired: boolean;
  /** Saved questions that applicants already answered; deleting drops their answers. */
  answerCount?: number;
};

export const SCREENING_QUESTION_TYPES: ScreeningQuestionType[] = ['TEXT', 'YES_NO', 'NUMBER'];
export const MAX_SCREENING_QUESTIONS = 20;

export function emptyScreeningQuestion(): ScreeningQuestionDraft {
  return { question: '', type: 'TEXT', isRequired: true };
}

/** Map API rows (listMine / job detail) into editor drafts. */
export function screeningDraftsFromJob(job: {
  questions?: Array<{
    id: string;
    question: string;
    type?: string | null;
    isRequired?: boolean | null;
    _count?: { answers?: number } | null;
  }> | null;
}): ScreeningQuestionDraft[] {
  return (job.questions || []).map((q) => ({
    id: q.id,
    question: q.question,
    type: SCREENING_QUESTION_TYPES.includes(q.type as ScreeningQuestionType)
      ? (q.type as ScreeningQuestionType)
      : 'TEXT',
    isRequired: q.isRequired !== false,
    answerCount: q._count?.answers ?? 0,
  }));
}

type Props = {
  value: ScreeningQuestionDraft[];
  onChange: (next: ScreeningQuestionDraft[]) => void;
  /** Return false to keep a saved question (e.g. the user cancelled a confirm). */
  onRemoveSaved?: (question: ScreeningQuestionDraft) => Promise<boolean> | boolean;
  idPrefix: string;
};

export function ScreeningQuestionsEditor({ value, onChange, onRemoveSaved, idPrefix }: Props) {
  const { t } = useI18n();

  function update(index: number, patch: Partial<ScreeningQuestionDraft>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function remove(index: number) {
    const row = value[index];
    if (row?.id && onRemoveSaved) {
      const ok = await onRemoveSaved(row);
      if (!ok) return;
    }
    onChange(value.filter((_, i) => i !== index));
  }

  function typeLabel(type: ScreeningQuestionType) {
    if (type === 'YES_NO') return t('rec.screeningTypeYesNo');
    if (type === 'NUMBER') return t('rec.screeningTypeNumber');
    return t('rec.screeningTypeText');
  }

  return (
    <div className="screening-editor">
      <LabelText>{t('rec.screeningTitle')}</LabelText>
      <p className="muted" style={{ fontSize: '0.78rem', margin: '0.25rem 0 0.4rem' }}>
        {t('rec.screeningHint')}
      </p>
      {value.length === 0 && (
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.25rem 0' }}>
          {t('rec.screeningEmpty')}
        </p>
      )}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {value.map((row, index) => {
          const inputId = `${idPrefix}-q-${index}`;
          return (
            <div key={row.id || `new-${index}`} className="screening-row card" style={{ padding: '0.6rem' }}>
              <label htmlFor={inputId}>
                <LabelText required>
                  {t('rec.screeningQuestionLabel').replace('{n}', String(index + 1))}
                </LabelText>
                <input
                  id={inputId}
                  value={row.question}
                  minLength={3}
                  maxLength={500}
                  required
                  placeholder={t('rec.screeningQuestionPlaceholder')}
                  onChange={(e) => update(index, { question: e.target.value })}
                />
              </label>
              <div
                style={{
                  display: 'flex',
                  gap: '0.6rem',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  marginTop: '0.4rem',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                  <span className="muted" style={{ fontSize: '0.78rem' }}>
                    {t('rec.screeningType')}
                  </span>
                  <select
                    value={row.type}
                    onChange={(e) => update(index, { type: e.target.value as ScreeningQuestionType })}
                    aria-label={t('rec.screeningType')}
                  >
                    {SCREENING_QUESTION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {typeLabel(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={row.isRequired}
                    onChange={(e) => update(index, { isRequired: e.target.checked })}
                  />
                  <span style={{ fontSize: '0.8rem' }}>{t('rec.screeningRequired')}</span>
                </label>
                {row.id && (row.answerCount ?? 0) > 0 ? (
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {t('rec.screeningAnswerCount').replace('{n}', String(row.answerCount))}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="ghost"
                  style={{ marginLeft: 'auto', fontSize: '0.8rem' }}
                  onClick={() => void remove(index)}
                >
                  {t('rec.screeningRemove')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {value.length < MAX_SCREENING_QUESTIONS && (
        <button
          type="button"
          className="chip"
          style={{ marginTop: '0.5rem' }}
          onClick={() => onChange([...value, emptyScreeningQuestion()])}
        >
          {t('rec.screeningAdd')}
        </button>
      )}
    </div>
  );
}
