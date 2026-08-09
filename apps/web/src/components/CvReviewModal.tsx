'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';

export type ParsedCv = {
  email?: string;
  phone?: string;
  headline?: string;
  summary?: string;
  skillNames?: string[];
  experiences?: Array<{
    title: string;
    companyName: string;
    startDate?: string | null;
    endDate?: string | null;
    isCurrent?: boolean;
    description?: string;
  }>;
  educations?: Array<{
    school: string;
    degree?: string;
    field?: string;
    startDate?: string | null;
    endDate?: string | null;
  }>;
  languages?: Array<{ name: string; code?: string; level?: string }>;
  textPreview?: string;
};

type Props = {
  resumeId: string;
  parsed: ParsedCv;
  onClose: () => void;
  onImported: () => void;
};

export function CvReviewModal({ resumeId, parsed, onClose, onImported }: Props) {
  const skills = parsed.skillNames || [];
  const experiences = parsed.experiences || [];
  const educations = parsed.educations || [];
  const languages = parsed.languages || [];

  const [headline, setHeadline] = useState(Boolean(parsed.headline));
  const [summary, setSummary] = useState(Boolean(parsed.summary));
  const [phone, setPhone] = useState(Boolean(parsed.phone));
  const [skillIndexes, setSkillIndexes] = useState<number[]>(() => skills.map((_, i) => i));
  const [experienceIndexes, setExperienceIndexes] = useState<number[]>(() =>
    experiences.map((_, i) => i),
  );
  const [educationIndexes, setEducationIndexes] = useState<number[]>(() =>
    educations.map((_, i) => i),
  );
  const [languageIndexes, setLanguageIndexes] = useState<number[]>(() =>
    languages.map((_, i) => i),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedCount = useMemo(
    () =>
      (headline ? 1 : 0) +
      (summary ? 1 : 0) +
      (phone ? 1 : 0) +
      skillIndexes.length +
      experienceIndexes.length +
      educationIndexes.length +
      languageIndexes.length,
    [
      headline,
      summary,
      phone,
      skillIndexes,
      experienceIndexes,
      educationIndexes,
      languageIndexes,
    ],
  );

  function toggleIndex(list: number[], setList: (v: number[]) => void, idx: number) {
    setList(list.includes(idx) ? list.filter((i) => i !== idx) : [...list, idx]);
  }

  async function importSelected() {
    setBusy(true);
    setError('');
    try {
      await api(`/profiles/me/resumes/${resumeId}/import`, {
        method: 'POST',
        body: JSON.stringify({
          headline,
          summary,
          phone,
          skillIndexes,
          experienceIndexes,
          educationIndexes,
          languageIndexes,
        }),
      });
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal cv-review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cv-review-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cv-review-header">
          <div>
            <h2 id="cv-review-title" style={{ margin: 0 }}>
              Review parsed CV
            </h2>
            <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
              Choose what to import into your profile. Uncheck anything that looks wrong.
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        {error && (
          <div className="error" style={{ marginBottom: '1rem' }} role="alert">
            {error}
          </div>
        )}

        <div className="cv-review-body">
          {(parsed.headline || parsed.summary || parsed.phone || parsed.email) && (
            <section className="cv-section">
              <h4>Profile basics</h4>
              {parsed.headline && (
                <label className="cv-check">
                  <input type="checkbox" checked={headline} onChange={(e) => setHeadline(e.target.checked)} />
                  <div>
                    <strong>Headline</strong>
                    <span>{parsed.headline}</span>
                  </div>
                </label>
              )}
              {parsed.summary && (
                <label className="cv-check">
                  <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} />
                  <div>
                    <strong>Summary</strong>
                    <span>{parsed.summary}</span>
                  </div>
                </label>
              )}
              {parsed.phone && (
                <label className="cv-check">
                  <input type="checkbox" checked={phone} onChange={(e) => setPhone(e.target.checked)} />
                  <div>
                    <strong>Phone</strong>
                    <span>{parsed.phone}</span>
                  </div>
                </label>
              )}
              {parsed.email && (
                <div className="cv-check muted" style={{ paddingLeft: '1.75rem' }}>
                  <div>
                    <strong>Email detected</strong>
                    <span>{parsed.email} (kept as reference — account email unchanged)</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {skills.length > 0 && (
            <section className="cv-section">
              <div className="cv-section-head">
                <h4>Skills ({skills.length})</h4>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setSkillIndexes(skillIndexes.length === skills.length ? [] : skills.map((_, i) => i))
                  }
                >
                  {skillIndexes.length === skills.length ? 'Clear' : 'Select all'}
                </button>
              </div>
              <div className="chips">
                {skills.map((s, i) => (
                  <label key={`${s}-${i}`} className={`chip ${skillIndexes.includes(i) ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={skillIndexes.includes(i)}
                      onChange={() => toggleIndex(skillIndexes, setSkillIndexes, i)}
                      style={{ width: 'auto' }}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </section>
          )}

          {experiences.length > 0 && (
            <section className="cv-section">
              <h4>Work experience</h4>
              {experiences.map((x, i) => (
                <label key={i} className="cv-check">
                  <input
                    type="checkbox"
                    checked={experienceIndexes.includes(i)}
                    onChange={() => toggleIndex(experienceIndexes, setExperienceIndexes, i)}
                  />
                  <div>
                    <strong>
                      {x.title} · {x.companyName}
                    </strong>
                    <span>
                      {x.startDate?.slice(0, 7) || '?'} — {x.isCurrent ? 'now' : x.endDate?.slice(0, 7) || '?'}
                      {x.description ? ` · ${x.description.slice(0, 120)}` : ''}
                    </span>
                  </div>
                </label>
              ))}
            </section>
          )}

          {educations.length > 0 && (
            <section className="cv-section">
              <h4>Education</h4>
              {educations.map((x, i) => (
                <label key={i} className="cv-check">
                  <input
                    type="checkbox"
                    checked={educationIndexes.includes(i)}
                    onChange={() => toggleIndex(educationIndexes, setEducationIndexes, i)}
                  />
                  <div>
                    <strong>{x.school}</strong>
                    <span>
                      {[x.degree, x.field].filter(Boolean).join(' · ') || 'Education'}
                    </span>
                  </div>
                </label>
              ))}
            </section>
          )}

          {languages.length > 0 && (
            <section className="cv-section">
              <h4>Languages</h4>
              {languages.map((x, i) => (
                <label key={i} className="cv-check">
                  <input
                    type="checkbox"
                    checked={languageIndexes.includes(i)}
                    onChange={() => toggleIndex(languageIndexes, setLanguageIndexes, i)}
                  />
                  <div>
                    <strong>{x.name}</strong>
                    <span>{x.level || 'B1'}</span>
                  </div>
                </label>
              ))}
            </section>
          )}

          {!selectedCount && (
            <p className="muted">Nothing selected — tick items above or close without importing.</p>
          )}
        </div>

        <div className="cv-review-footer">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Skip for now
          </button>
          <button type="button" onClick={importSelected} disabled={busy || selectedCount === 0}>
            {busy ? 'Importing…' : `Import selected (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
