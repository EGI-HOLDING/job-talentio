'use client';

import { useMemo, useState } from 'react';
import { catalogLabelIssue } from '@job-talentio/shared';
import { api } from '@/lib/api';
import { useEnumLabel, useI18n } from '@/lib/i18n';

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

const DEGREES = ['HIGH_SCHOOL', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'PHD'] as const;
const LANG_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'] as const;

type SkillDraft = { name: string; include: boolean };
type ExpDraft = {
  include: boolean;
  title: string;
  companyName: string;
  description: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
};
type EduDraft = {
  include: boolean;
  school: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
};
type LangDraft = { include: boolean; name: string; code?: string; level: string };

type Props = {
  resumeId: string;
  parsed: ParsedCv;
  onClose: () => void;
  onImported: () => void;
};

function dateInputValue(raw?: string | null) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function coerceDegree(raw?: string) {
  const value = (raw || '').trim().toUpperCase();
  return DEGREES.includes(value as (typeof DEGREES)[number]) ? value : '';
}

function coerceLevel(raw?: string) {
  const value = (raw || '').trim().toUpperCase();
  return LANG_LEVELS.includes(value as (typeof LANG_LEVELS)[number]) ? value : 'B1';
}

export function CvReviewModal({ resumeId, parsed, onClose, onImported }: Props) {
  const { t } = useI18n();
  const enumLabel = useEnumLabel();

  const [includeHeadline, setIncludeHeadline] = useState(Boolean(parsed.headline));
  const [headline, setHeadline] = useState(parsed.headline || '');
  const [includeSummary, setIncludeSummary] = useState(Boolean(parsed.summary));
  const [summary, setSummary] = useState(parsed.summary || '');
  const [includePhone, setIncludePhone] = useState(Boolean(parsed.phone));
  const [phone, setPhone] = useState(parsed.phone || '');

  const [skills, setSkills] = useState<SkillDraft[]>(() =>
    (parsed.skillNames || []).map((name) => ({
      name,
      include: !catalogLabelIssue(name),
    })),
  );
  const [experiences, setExperiences] = useState<ExpDraft[]>(() =>
    (parsed.experiences || []).map((x) => ({
      include: Boolean(x.title && x.companyName),
      title: x.title || '',
      companyName: x.companyName || '',
      description: x.description || '',
      startDate: dateInputValue(x.startDate),
      endDate: dateInputValue(x.endDate),
      isCurrent: Boolean(x.isCurrent),
    })),
  );
  const [educations, setEducations] = useState<EduDraft[]>(() =>
    (parsed.educations || []).map((x) => ({
      include: Boolean(x.school),
      school: x.school || '',
      degree: coerceDegree(x.degree),
      field: x.field || '',
      startDate: dateInputValue(x.startDate),
      endDate: dateInputValue(x.endDate),
    })),
  );
  const [languages, setLanguages] = useState<LangDraft[]>(() =>
    (parsed.languages || []).map((x) => ({
      include: Boolean(x.name) && !catalogLabelIssue(x.name),
      name: x.name || '',
      code: x.code,
      level: coerceLevel(x.level),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedCount = useMemo(() => {
    const basics =
      (includeHeadline && headline.trim() ? 1 : 0) +
      (includeSummary && summary.trim() ? 1 : 0) +
      (includePhone && phone.trim() ? 1 : 0);
    const skillCount = skills.filter((s) => s.include && s.name.trim() && !catalogLabelIssue(s.name)).length;
    const expCount = experiences.filter((x) => x.include && x.title.trim() && x.companyName.trim()).length;
    const eduCount = educations.filter((x) => x.include && x.school.trim()).length;
    const langCount = languages.filter((x) => x.include && x.name.trim() && !catalogLabelIssue(x.name)).length;
    return basics + skillCount + expCount + eduCount + langCount;
  }, [
    includeHeadline,
    headline,
    includeSummary,
    summary,
    includePhone,
    phone,
    skills,
    experiences,
    educations,
    languages,
  ]);

  const validSkillIndexes = skills
    .map((s, i) => (catalogLabelIssue(s.name) ? -1 : i))
    .filter((i) => i >= 0);
  const allValidSkillsSelected =
    validSkillIndexes.length > 0 && validSkillIndexes.every((i) => skills[i].include);

  function patchSkill(idx: number, patch: Partial<SkillDraft>) {
    setSkills((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        if (catalogLabelIssue(next.name)) next.include = false;
        return next;
      }),
    );
  }

  function patchLang(idx: number, patch: Partial<LangDraft>) {
    setLanguages((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        if (catalogLabelIssue(next.name)) next.include = false;
        return next;
      }),
    );
  }

  async function importSelected() {
    setBusy(true);
    setError('');
    try {
      await api(`/profiles/me/resumes/${resumeId}/import`, {
        method: 'POST',
        body: JSON.stringify({
          headline: includeHeadline && headline.trim() ? headline.trim() : undefined,
          summary: includeSummary && summary.trim() ? summary.trim() : undefined,
          phone: includePhone && phone.trim() ? phone.trim() : undefined,
          skills: skills
            .filter((s) => s.include && s.name.trim() && !catalogLabelIssue(s.name))
            .map((s) => s.name.trim()),
          experiences: experiences
            .filter((x) => x.include && x.title.trim() && x.companyName.trim())
            .map((x) => ({
              title: x.title.trim(),
              companyName: x.companyName.trim(),
              description: x.description.trim() || undefined,
              startDate: x.startDate || undefined,
              endDate: x.isCurrent ? null : x.endDate || undefined,
              isCurrent: x.isCurrent,
            })),
          educations: educations
            .filter((x) => x.include && x.school.trim())
            .map((x) => ({
              school: x.school.trim(),
              degree: coerceDegree(x.degree) || undefined,
              field: x.field.trim() || undefined,
              startDate: x.startDate || undefined,
              endDate: x.endDate || undefined,
            })),
          languages: languages
            .filter((x) => x.include && x.name.trim() && !catalogLabelIssue(x.name))
            .map((x) => ({
              name: x.name.trim(),
              code: x.code,
              level: coerceLevel(x.level),
            })),
        }),
      });
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ui.importFailed'));
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
              {t('reviewParsedData')}
            </h2>
            <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
              {t('ui.cvReviewSubtitle')}
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label={t('closeDialog')}>
            x
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
              <h4>{t('ui.profileBasics')}</h4>
              {parsed.headline !== undefined && parsed.headline !== '' && (
                <div className="cv-check">
                  <input
                    type="checkbox"
                    checked={includeHeadline}
                    onChange={(e) => setIncludeHeadline(e.target.checked)}
                    aria-label={t('ui.headline')}
                  />
                  <div className="cv-check-fields">
                    <strong>{t('ui.headline')}</strong>
                    <input
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                </div>
              )}
              {parsed.summary !== undefined && parsed.summary !== '' && (
                <div className="cv-check">
                  <input
                    type="checkbox"
                    checked={includeSummary}
                    onChange={(e) => setIncludeSummary(e.target.checked)}
                    aria-label={t('ui.summary')}
                  />
                  <div className="cv-check-fields">
                    <strong>{t('ui.summary')}</strong>
                    <textarea
                      rows={3}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      maxLength={5000}
                    />
                  </div>
                </div>
              )}
              {parsed.phone !== undefined && parsed.phone !== '' && (
                <div className="cv-check">
                  <input
                    type="checkbox"
                    checked={includePhone}
                    onChange={(e) => setIncludePhone(e.target.checked)}
                    aria-label={t('ui.phone')}
                  />
                  <div className="cv-check-fields">
                    <strong>{t('ui.phone')}</strong>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
                  </div>
                </div>
              )}
              {parsed.email && (
                <div className="cv-check muted" style={{ paddingLeft: '1.75rem' }}>
                  <div>
                    <strong>{t('ui.emailDetected')}</strong>
                    <span>
                      {parsed.email} {t('ui.emailKeptAsReference')}
                    </span>
                  </div>
                </div>
              )}
            </section>
          )}

          {skills.length > 0 && (
            <section className="cv-section">
              <div className="cv-section-head">
                <h4>
                  {t('skills')} ({skills.length})
                </h4>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setSkills((prev) =>
                      prev.map((s) => ({
                        ...s,
                        include: catalogLabelIssue(s.name)
                          ? false
                          : allValidSkillsSelected
                            ? false
                            : true,
                      })),
                    )
                  }
                >
                  {allValidSkillsSelected ? t('ui.clear') : t('ui.selectAll')}
                </button>
              </div>
              {skills.map((s, i) => {
                const issue = catalogLabelIssue(s.name);
                return (
                  <div key={i} className={`cv-check${issue ? ' cv-check--invalid' : ''}`}>
                    <input
                      type="checkbox"
                      checked={s.include}
                      disabled={Boolean(issue)}
                      onChange={(e) => patchSkill(i, { include: e.target.checked })}
                      aria-label={s.name || t('skills')}
                    />
                    <div className="cv-check-fields">
                      <input
                        value={s.name}
                        onChange={(e) => patchSkill(i, { name: e.target.value })}
                        maxLength={80}
                      />
                      {issue && <p className="cv-check-warn">{t('ui.cvCatalogLabelInvalid')}</p>}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {experiences.length > 0 && (
            <section className="cv-section">
              <h4>{t('experience')}</h4>
              {experiences.map((x, i) => (
                <div key={i} className="cv-check">
                  <input
                    type="checkbox"
                    checked={x.include}
                    onChange={(e) =>
                      setExperiences((prev) =>
                        prev.map((row, idx) => (idx === i ? { ...row, include: e.target.checked } : row)),
                      )
                    }
                    aria-label={x.title || t('experience')}
                  />
                  <div className="cv-check-fields">
                    <div className="grid-2">
                      <label>
                        <strong>{t('emp.positionTitle')}</strong>
                        <input
                          value={x.title}
                          onChange={(e) =>
                            setExperiences((prev) =>
                              prev.map((row, idx) => (idx === i ? { ...row, title: e.target.value } : row)),
                            )
                          }
                          maxLength={160}
                        />
                      </label>
                      <label>
                        <strong>{t('company')}</strong>
                        <input
                          value={x.companyName}
                          onChange={(e) =>
                            setExperiences((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, companyName: e.target.value } : row,
                              ),
                            )
                          }
                          maxLength={160}
                        />
                      </label>
                    </div>
                    <label>
                      <strong>{t('emp.description')}</strong>
                      <textarea
                        rows={2}
                        value={x.description}
                        onChange={(e) =>
                          setExperiences((prev) =>
                            prev.map((row, idx) =>
                              idx === i ? { ...row, description: e.target.value } : row,
                            ),
                          )
                        }
                        maxLength={5000}
                      />
                    </label>
                    <div className="grid-2">
                      <label>
                        <strong>{t('emp.start')}</strong>
                        <input
                          type="date"
                          value={x.startDate}
                          onChange={(e) =>
                            setExperiences((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, startDate: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        <strong>{t('emp.end')}</strong>
                        <input
                          type="date"
                          value={x.endDate}
                          disabled={x.isCurrent}
                          onChange={(e) =>
                            setExperiences((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, endDate: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={x.isCurrent}
                        onChange={(e) =>
                          setExperiences((prev) =>
                            prev.map((row, idx) =>
                              idx === i ? { ...row, isCurrent: e.target.checked } : row,
                            ),
                          )
                        }
                      />
                      <span>{t('emp.currentlyWorkHere')}</span>
                    </label>
                  </div>
                </div>
              ))}
            </section>
          )}

          {educations.length > 0 && (
            <section className="cv-section">
              <h4>{t('education')}</h4>
              {educations.map((x, i) => (
                <div key={i} className="cv-check">
                  <input
                    type="checkbox"
                    checked={x.include}
                    onChange={(e) =>
                      setEducations((prev) =>
                        prev.map((row, idx) => (idx === i ? { ...row, include: e.target.checked } : row)),
                      )
                    }
                    aria-label={x.school || t('education')}
                  />
                  <div className="cv-check-fields">
                    <label>
                      <strong>{t('emp.school')}</strong>
                      <input
                        value={x.school}
                        onChange={(e) =>
                          setEducations((prev) =>
                            prev.map((row, idx) => (idx === i ? { ...row, school: e.target.value } : row)),
                          )
                        }
                        maxLength={200}
                      />
                    </label>
                    <div className="grid-2">
                      <label>
                        <strong>{t('emp.degree')}</strong>
                        <select
                          value={x.degree}
                          onChange={(e) =>
                            setEducations((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, degree: e.target.value } : row,
                              ),
                            )
                          }
                        >
                          <option value="">-</option>
                          {DEGREES.map((d) => (
                            <option key={d} value={d}>
                              {enumLabel('degree', d)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <strong>{t('emp.field')}</strong>
                        <input
                          value={x.field}
                          onChange={(e) =>
                            setEducations((prev) =>
                              prev.map((row, idx) => (idx === i ? { ...row, field: e.target.value } : row)),
                            )
                          }
                          maxLength={160}
                        />
                      </label>
                    </div>
                    <div className="grid-2">
                      <label>
                        <strong>{t('emp.start')}</strong>
                        <input
                          type="date"
                          value={x.startDate}
                          onChange={(e) =>
                            setEducations((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, startDate: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        <strong>{t('emp.end')}</strong>
                        <input
                          type="date"
                          value={x.endDate}
                          onChange={(e) =>
                            setEducations((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, endDate: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}

          {languages.length > 0 && (
            <section className="cv-section">
              <h4>{t('languages')}</h4>
              {languages.map((x, i) => {
                const issue = catalogLabelIssue(x.name);
                return (
                  <div key={i} className={`cv-check${issue ? ' cv-check--invalid' : ''}`}>
                    <input
                      type="checkbox"
                      checked={x.include}
                      disabled={Boolean(issue)}
                      onChange={(e) => patchLang(i, { include: e.target.checked })}
                      aria-label={x.name || t('languages')}
                    />
                    <div className="cv-check-fields">
                      <div className="grid-2">
                        <label>
                          <strong>{t('emp.name')}</strong>
                          <input
                            value={x.name}
                            onChange={(e) => patchLang(i, { name: e.target.value })}
                            maxLength={80}
                          />
                        </label>
                        <label>
                          <strong>{t('ui.level')}</strong>
                          <select
                            value={x.level}
                            onChange={(e) => patchLang(i, { level: e.target.value })}
                            aria-label={t('emp.levelFor').replace('{name}', x.name || t('languages'))}
                          >
                            {LANG_LEVELS.map((l) => (
                              <option key={l} value={l}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {issue && <p className="cv-check-warn">{t('ui.cvCatalogLabelInvalid')}</p>}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {!selectedCount && <p className="muted">{t('ui.nothingSelectedHint')}</p>}
        </div>

        <div className="cv-review-footer">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            {t('ui.skipForNow')}
          </button>
          <button type="button" onClick={importSelected} disabled={busy || selectedCount === 0}>
            {busy
              ? t('ui.importing')
              : t('ui.importSelected').replace('{n}', String(selectedCount))}
          </button>
        </div>
      </div>
    </div>
  );
}
