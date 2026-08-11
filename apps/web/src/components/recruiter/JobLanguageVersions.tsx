'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { LOCALES, type Locale } from '@/lib/locale';
import { LabelText } from '@/components/ui/Field';

type JobTranslation = {
  locale: Locale;
  title: string;
  description: string;
  isMachine: boolean;
};

type JobTranslations = {
  sourceLocale: Locale;
  source: { title: string; description: string };
  translations: JobTranslation[];
};

type Draft = { title: string; description: string };

const LOCALE_NAME_KEY: Record<Locale, string> = {
  uz: 'rec.localeNameUz',
  ru: 'rec.localeNameRu',
  en: 'rec.localeNameEn',
};

const EMPTY_DRAFT: Draft = { title: '', description: '' };

type Props = {
  jobId: string;
  /** Dashboard flash banner, so errors land where the recruiter already looks. */
  onFlash: (message: string, tone?: 'success' | 'error') => void;
};

/**
 * Optional extra language versions of one posting. The source language stays in
 * the main edit form; this only writes `/jobs/:id/translations/:locale`.
 */
export function JobLanguageVersions({ jobId, onFlash }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<JobTranslations | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<Locale, Draft>>>({});
  const [busyLocale, setBusyLocale] = useState<Locale | null>(null);

  // The parent rebuilds `flash` every render; keep it out of the load deps.
  const flashRef = useRef(onFlash);
  useEffect(() => {
    flashRef.current = onFlash;
  }, [onFlash]);

  const load = useCallback(async () => {
    try {
      const res = await api<JobTranslations>(`/jobs/${jobId}/translations`);
      setData(res);
      setLoadFailed(false);
      // Saved text wins; anything typed for a language with no version yet is kept.
      setDrafts((prev) => {
        const next: Partial<Record<Locale, Draft>> = {};
        for (const locale of LOCALES) {
          const saved = res.translations.find((tr) => tr.locale === locale);
          if (saved) next[locale] = { title: saved.title, description: saved.description };
          else if (prev[locale]) next[locale] = prev[locale];
        }
        return next;
      });
    } catch (err) {
      setLoadFailed(true);
      flashRef.current(
        err instanceof Error ? err.message : t('rec.langVersionsLoadFailed'),
        'error',
      );
    }
  }, [jobId, t]);

  useEffect(() => {
    load();
  }, [load]);

  function updateDraft(locale: Locale, patch: Partial<Draft>) {
    setDrafts((prev) => ({
      ...prev,
      [locale]: { ...EMPTY_DRAFT, ...prev[locale], ...patch },
    }));
  }

  async function saveVersion(locale: Locale) {
    const draft = drafts[locale] ?? EMPTY_DRAFT;
    const title = draft.title.trim();
    const description = draft.description.trim();
    const langName = t(LOCALE_NAME_KEY[locale]);
    if (!title || !description) {
      onFlash(t('rec.langVersionFillBoth').replace('{lang}', langName), 'error');
      return;
    }
    setBusyLocale(locale);
    try {
      await api(`/jobs/${jobId}/translations/${locale}`, {
        method: 'PUT',
        body: JSON.stringify({ title, description }),
      });
      onFlash(t('rec.langVersionSaved').replace('{lang}', langName));
      await load();
    } catch (err) {
      onFlash(err instanceof Error ? err.message : t('rec.langVersionSaveFailed'), 'error');
    } finally {
      setBusyLocale(null);
    }
  }

  async function deleteVersion(locale: Locale) {
    const langName = t(LOCALE_NAME_KEY[locale]);
    if (!confirm(t('rec.langVersionConfirmDelete').replace('{lang}', langName))) return;
    setBusyLocale(locale);
    try {
      await api(`/jobs/${jobId}/translations/${locale}`, { method: 'DELETE' });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[locale];
        return next;
      });
      onFlash(t('rec.langVersionDeleted').replace('{lang}', langName));
      await load();
    } catch (err) {
      onFlash(err instanceof Error ? err.message : t('rec.langVersionDeleteFailed'), 'error');
    } finally {
      setBusyLocale(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: '0.75rem' }}>
      <h4 style={{ margin: 0 }}>{t('rec.langVersionsTitle')}</h4>
      <p className="muted" style={{ margin: '0.35rem 0 0.65rem', fontSize: '0.85rem' }}>
        {t('rec.langVersionsHint')}
      </p>
      {loadFailed ? (
        <p className="muted" style={{ margin: 0 }}>
          {t('rec.langVersionsLoadFailed')}
        </p>
      ) : !data ? (
        <p className="muted" style={{ margin: 0 }}>
          {t('rec.loading')}
        </p>
      ) : (
        <>
          <div className="chips" style={{ alignItems: 'center' }}>
            <span className="badge">
              {t('rec.langVersionSource').replace(
                '{lang}',
                t(LOCALE_NAME_KEY[data.sourceLocale]),
              )}
            </span>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {t('rec.langVersionSourceRef')}: {data.source.title}
            </span>
          </div>
          <p className="muted" style={{ margin: '0.45rem 0 0', fontSize: '0.8rem' }}>
            {t('rec.langVersionSourceNote')}
          </p>
          {LOCALES.filter((locale) => locale !== data.sourceLocale).map((locale) => {
            const saved = data.translations.find((tr) => tr.locale === locale);
            const draft = drafts[locale] ?? EMPTY_DRAFT;
            const busy = busyLocale === locale;
            const langName = t(LOCALE_NAME_KEY[locale]);
            return (
              <div
                key={locale}
                style={{
                  marginTop: '0.85rem',
                  paddingTop: '0.85rem',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div className="chips" style={{ alignItems: 'center' }}>
                  <strong>{langName}</strong>
                  <span className="badge">
                    {!saved
                      ? t('rec.langVersionMissing')
                      : saved.isMachine
                        ? t('rec.langVersionMachine')
                        : t('rec.langVersionHuman')}
                  </span>
                </div>
                {saved?.isMachine && (
                  <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
                    {t('rec.langVersionMachineNote')}
                  </p>
                )}
                <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.6rem' }}>
                  <label>
                    <LabelText required>{t('jobTitleFilter')}</LabelText>
                    <input
                      value={draft.title}
                      maxLength={200}
                      disabled={busy}
                      onChange={(e) => updateDraft(locale, { title: e.target.value })}
                    />
                  </label>
                  <label>
                    <LabelText required>{t('rec.description')}</LabelText>
                    <textarea
                      rows={4}
                      value={draft.description}
                      maxLength={20000}
                      disabled={busy}
                      onChange={(e) => updateDraft(locale, { description: e.target.value })}
                    />
                  </label>
                </div>
                <div className="chips" style={{ marginTop: '0.6rem' }}>
                  <button
                    type="button"
                    className="chip active"
                    disabled={busy}
                    onClick={() => saveVersion(locale)}
                  >
                    {busy ? t('saving') : t('rec.langVersionSave')}
                  </button>
                  {saved && (
                    <button
                      type="button"
                      className="chip"
                      disabled={busy}
                      onClick={() => deleteVersion(locale)}
                    >
                      {t('rec.langVersionDelete')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
