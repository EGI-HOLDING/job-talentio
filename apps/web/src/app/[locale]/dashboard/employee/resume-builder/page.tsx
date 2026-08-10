'use client';

import { Suspense } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, localeHref } from '@/lib/navigation';
import { useSearchParams } from 'next/navigation';
import {
  DEFAULT_RESUME_INCLUSION,
  type ResumeInclusion,
  type ResumeTemplateKey,
} from '@job-talentio/shared';
import { api, getSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { FormAlert, LabelText } from '@/components/ui/Field';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { ResumePreview, type ResumePreviewDocument } from '@/components/resume/ResumePreview';
import { ResumeChecklistPanel } from '@/components/resume/ResumeChecklistPanel';

type SourceLists = {
  skills: Array<{ id: string; name: string; level?: string }>;
  experiences: Array<{ id: string; title: string; companyName: string }>;
  educations: Array<{ id: string; school: string }>;
  languages: Array<{ id: string; name: string; level?: string }>;
  certifications: Array<{ id: string; name: string }>;
};

type ResumeDocPayload = {
  resume: {
    id: string;
    title: string;
    isPrimary: boolean;
    templateKey: ResumeTemplateKey | string;
    themeAccent?: string | null;
    inclusion: ResumeInclusion;
    hasFile?: boolean;
  } | null;
  document: ResumePreviewDocument;
  source: SourceLists;
  checklist: { score: number; items: Array<{ id: string; label: string; ok: boolean; tip?: string }> };
};

const SECTION_KEYS = [
  ['summary', 'emp.summary'],
  ['skills', 'skills'],
  ['experience', 'experience'],
  ['education', 'education'],
  ['languages', 'languages'],
  ['certifications', 'certifications'],
  ['email', 'email'],
  ['phone', 'emp.phone'],
] as const;

const TEMPLATES: Array<{ key: ResumeTemplateKey; labelKey: string }> = [
  { key: 'classic', labelKey: 'emp.templateClassic' },
  { key: 'modern', labelKey: 'emp.templateModern' },
  { key: 'compact', labelKey: 'emp.templateCompact' },
];

function normalizeInclusion(raw?: ResumeInclusion | null): typeof DEFAULT_RESUME_INCLUSION {
  if (!raw) {
    return {
      ...DEFAULT_RESUME_INCLUSION,
      sections: { ...DEFAULT_RESUME_INCLUSION.sections },
    };
  }
  return {
    sections: {
      ...DEFAULT_RESUME_INCLUSION.sections,
      ...(raw.sections || {}),
    },
    experienceIds: raw.experienceIds ?? null,
    educationIds: raw.educationIds ?? null,
    skillIds: raw.skillIds ?? null,
    languageIds: raw.languageIds ?? null,
    certificationIds: raw.certificationIds ?? null,
  };
}

function ResumeBuilderInner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const resumeIdParam = searchParams.get('resumeId') || undefined;

  const [payload, setPayload] = useState<ResumeDocPayload | null>(null);
  const [title, setTitle] = useState('My Resume');
  const [templateKey, setTemplateKey] = useState<ResumeTemplateKey>('classic');
  const [inclusion, setInclusion] = useState(normalizeInclusion(null));
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [ready, setReady] = useState(false);
  const skipDebounce = useRef(true);
  const resumeId = payload?.resume?.id;
  const hasAttachedFile = Boolean(payload?.resume?.hasFile);

  const load = useCallback(async (id?: string) => {
    const session = getSession();
    if (!session || session.user.role !== 'EMPLOYEE') {
      window.location.href = localeHref('/login');
      return;
    }
    const q = id ? `?resumeId=${encodeURIComponent(id)}` : '';
    let data = await api<ResumeDocPayload>(`/profiles/me/resume-document${q}`);
    if (!data.resume) {
      const created = await api<{ id: string }>('/profiles/me/resumes/from-builder', {
        method: 'POST',
        body: JSON.stringify({ title: 'My Resume' }),
      });
      data = await api<ResumeDocPayload>(
        `/profiles/me/resume-document?resumeId=${encodeURIComponent(created.id)}`,
      );
      if (typeof window !== 'undefined' && created.id) {
        const url = new URL(window.location.href);
        url.searchParams.set('resumeId', created.id);
        window.history.replaceState({}, '', url.toString());
      }
    }
    skipDebounce.current = true;
    setPayload(data);
    if (data.resume) {
      setTitle(data.resume.title || 'My Resume');
      setTemplateKey((data.resume.templateKey as ResumeTemplateKey) || 'classic');
      setInclusion(normalizeInclusion(data.resume.inclusion));
    }
    setReady(true);
  }, []);

  useEffect(() => {
    load(resumeIdParam).catch((e) =>
      setError(e instanceof Error ? e.message : t('emp.loadFailed')),
    );
  }, [load, resumeIdParam]);

  useEffect(() => {
    if (!resumeId || !ready) return;
    if (skipDebounce.current) {
      skipDebounce.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      setSaving(true);
      api(`/profiles/me/resumes/${resumeId}/builder`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          templateKey,
          inclusion,
        }),
      })
        .then(() => load(resumeId))
        .then(() => setMsg(t('emp.saved')))
        .catch((e) => setError(e instanceof Error ? e.message : t('emp.saveFailed')))
        .finally(() => setSaving(false));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [title, templateKey, inclusion, resumeId, ready, load]);

  function toggleSection(key: (typeof SECTION_KEYS)[number][0]) {
    setInclusion((prev) => ({
      ...prev,
      sections: { ...prev.sections, [key]: !prev.sections[key] },
    }));
  }

  function toggleId(
    field: 'experienceIds' | 'educationIds' | 'skillIds' | 'languageIds' | 'certificationIds',
    id: string,
    allIds: string[],
  ) {
    setInclusion((prev) => {
      const current = prev[field] == null ? [...allIds] : [...(prev[field] || [])];
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      const allSelected = allIds.length > 0 && allIds.every((x) => next.includes(x));
      return { ...prev, [field]: allSelected ? null : next };
    });
  }

  function isIdChecked(
    field: 'experienceIds' | 'educationIds' | 'skillIds' | 'languageIds' | 'certificationIds',
    id: string,
  ) {
    const ids = inclusion[field];
    if (ids == null) return true;
    return ids.includes(id);
  }

  async function setPrimary() {
    if (!resumeId) return;
    await api(`/profiles/me/resumes/${resumeId}/builder`, {
      method: 'PATCH',
      body: JSON.stringify({ isPrimary: true }),
    });
    setMsg(t('emp.setAsPrimaryDone'));
    await load(resumeId);
  }

  async function exportPdf() {
    if (!resumeId) return;
    setExporting(true);
    setError('');
    try {
      await api(`/profiles/me/resumes/${resumeId}/builder`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          templateKey,
          inclusion,
        }),
      });
      const res = await api<{ downloadUrl?: string }>(`/profiles/me/resumes/${resumeId}/export`, {
        method: 'POST',
      });
      setShowExportConfirm(false);
      setMsg(t('emp.pdfExported'));
      if (res.downloadUrl) window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
      await load(resumeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('emp.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const previewDoc = useMemo(() => payload?.document, [payload]);

  if (!ready && !error) return <DashboardSkeleton />;

  return (
    <div className="shell resume-builder-page">
      {showExportConfirm && (
        <ConfirmModal
          title={t('exportPdfConfirmTitle')}
          message={
            hasAttachedFile ? t('exportPdfReplaceWarning') : t('exportPdfAttachWarning')
          }
          confirmLabel={t('exportPdfConfirm')}
          cancelLabel={t('cancel')}
          danger={hasAttachedFile}
          busy={exporting}
          onCancel={() => {
            if (!exporting) setShowExportConfirm(false);
          }}
          onConfirm={() => {
            void exportPdf();
          }}
        />
      )}
      <div className="resume-builder-toolbar">
        <div>
          <Link href="/dashboard/employee?tab=profile" className="ghost" style={{ padding: 0 }}>
            ← {t('emp.backToProfile')}
          </Link>
          <h1 className="section-title" style={{ margin: '0.35rem 0 0' }}>
            {t('resumeMethodBuilder')}
          </h1>
        </div>
        <div className="resume-builder-actions">
          {saving && <span className="muted" style={{ fontSize: '0.85rem' }}>{t('saving')}</span>}
          <button type="button" className="secondary" onClick={setPrimary} disabled={!resumeId}>
            {t('emp.setPrimary')}
          </button>
          <button
            type="button"
            className="cta"
            onClick={() => setShowExportConfirm(true)}
            disabled={!resumeId || exporting}
          >
            {exporting ? t('emp.exporting') : t('exportPdf')}
          </button>
        </div>
      </div>

      {error && <FormAlert>{error}</FormAlert>}
      {msg && <FormAlert tone="success">{msg}</FormAlert>}

      <div className="resume-builder-layout">
        <aside className="card resume-builder-sidebar">
          <label>
            <LabelText>{t('resumeDisplayName')}</LabelText>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <div style={{ marginTop: '1rem' }}>
            <LabelText>{t('emp.template')}</LabelText>
            <div className="chips" style={{ marginTop: '0.4rem' }}>
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  className={`chip ${templateKey === tpl.key ? 'active' : ''}`}
                  onClick={() => setTemplateKey(tpl.key)}
                >
                  {t(tpl.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>{t('emp.sections')}</h3>
            {SECTION_KEYS.map(([key, labelKey]) => (
              <label key={key} className="resume-builder-check">
                <input
                  type="checkbox"
                  checked={Boolean(inclusion.sections[key])}
                  onChange={() => toggleSection(key)}
                />
                <span>{t(labelKey)}</span>
              </label>
            ))}
          </div>

          {payload?.source && (
            <>
              {inclusion.sections.experience && payload.source.experiences.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>{t('emp.experiences')}</h3>
                  {payload.source.experiences.map((e) => (
                    <label key={e.id} className="resume-builder-check">
                      <input
                        type="checkbox"
                        checked={isIdChecked('experienceIds', e.id)}
                        onChange={() =>
                          toggleId(
                            'experienceIds',
                            e.id,
                            payload.source.experiences.map((x) => x.id),
                          )
                        }
                      />
                      <span>
                        {e.title}
                        <span className="muted"> | {e.companyName}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {inclusion.sections.education && payload.source.educations.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>{t('education')}</h3>
                  {payload.source.educations.map((e) => (
                    <label key={e.id} className="resume-builder-check">
                      <input
                        type="checkbox"
                        checked={isIdChecked('educationIds', e.id)}
                        onChange={() =>
                          toggleId(
                            'educationIds',
                            e.id,
                            payload.source.educations.map((x) => x.id),
                          )
                        }
                      />
                      <span>{e.school}</span>
                    </label>
                  ))}
                </div>
              )}

              {inclusion.sections.skills && payload.source.skills.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>{t('skills')}</h3>
                  {payload.source.skills.map((s) => (
                    <label key={s.id} className="resume-builder-check">
                      <input
                        type="checkbox"
                        checked={isIdChecked('skillIds', s.id)}
                        onChange={() =>
                          toggleId(
                            'skillIds',
                            s.id,
                            payload.source.skills.map((x) => x.id),
                          )
                        }
                      />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
              )}

              {inclusion.sections.languages && payload.source.languages.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>{t('languages')}</h3>
                  {payload.source.languages.map((l) => (
                    <label key={l.id} className="resume-builder-check">
                      <input
                        type="checkbox"
                        checked={isIdChecked('languageIds', l.id)}
                        onChange={() =>
                          toggleId(
                            'languageIds',
                            l.id,
                            payload.source.languages.map((x) => x.id),
                          )
                        }
                      />
                      <span>{l.name}</span>
                    </label>
                  ))}
                </div>
              )}

              {inclusion.sections.certifications && payload.source.certifications.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>{t('certifications')}</h3>
                  {payload.source.certifications.map((c) => (
                    <label key={c.id} className="resume-builder-check">
                      <input
                        type="checkbox"
                        checked={isIdChecked('certificationIds', c.id)}
                        onChange={() =>
                          toggleId(
                            'certificationIds',
                            c.id,
                            payload.source.certifications.map((x) => x.id),
                          )
                        }
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </aside>

        <div className="resume-builder-preview-wrap">
          {previewDoc ? (
            <ResumePreview
              document={previewDoc}
              templateKey={templateKey}
              themeAccent={payload?.resume?.themeAccent}
            />
          ) : (
            <p className="muted">{t('emp.loadingPreview')}</p>
          )}
        </div>

        {payload?.checklist ? <ResumeChecklistPanel checklist={payload.checklist} /> : null}
      </div>
    </div>
  );
}

export default function ResumeBuilderPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <ResumeBuilderInner />
    </Suspense>
  );
}
